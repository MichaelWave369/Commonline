import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type SourceKind = "human-microphone" | "sound-effect";

interface HumanBrowser {
  name: string;
  context: BrowserContext;
  page: Page;
}

function subscriptionButton(
  page: Page,
  kind: SourceKind,
  ownerName: string
) {
  return page.locator(
    `button[data-acceptance-subscription="true"][data-source-kind="${kind}"][data-owner-name="${ownerName}"]`
  );
}

function sourceRow(
  page: Page,
  kind: SourceKind,
  ownerName: string
) {
  return page.locator(
    `[data-acceptance-source="true"][data-source-kind="${kind}"][data-owner-name="${ownerName}"]`
  );
}

function consumerCard(
  page: Page,
  kind: SourceKind,
  ownerName: string
) {
  return page.locator(
    `[data-acceptance-consumer="true"][data-source-kind="${kind}"][data-owner-name="${ownerName}"]`
  );
}

async function newHuman(
  browser: Browser,
  name: string
): Promise<HumanBrowser> {
  const context = await browser.newContext({
    permissions: ["microphone"]
  });
  const page = await context.newPage();

  await page.goto("/");
  await page.getByLabel("Display name").fill(name);
  await page.getByTestId("authenticate-join").click();

  await expect(
    page.getByRole("button", { name: "Leave episode" })
  ).toBeVisible();

  return { name, context, page };
}

async function joinGroup(human: HumanBrowser) {
  await human.page.getByTestId("join-group-media").click();
  await expect(
    human.page.getByRole("button", {
      name: "Publish microphone"
    })
  ).toBeVisible();
}

async function expectPackets(locator: Locator) {
  await expect(locator).toHaveCount(1);

  await expect
    .poll(
      async () =>
        Number(
          (await locator.getAttribute("data-packets-received")) ??
            "0"
        ),
      {
        timeout: 20_000,
        message: "expected live inbound RTP packet evidence"
      }
    )
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () =>
        Number(
          (await locator.getAttribute("data-bytes-received")) ??
            "0"
        ),
      {
        timeout: 20_000,
        message: "expected live inbound RTP byte evidence"
      }
    )
    .toBeGreaterThan(0);
}

async function evidence(locator: Locator) {
  return {
    sourceId: await locator.getAttribute("data-source-id"),
    sourceKind: await locator.getAttribute("data-source-kind"),
    ownerName: await locator.getAttribute("data-owner-name"),
    trackState: await locator.getAttribute("data-track-state"),
    packetsReceived: Number(
      (await locator.getAttribute("data-packets-received")) ?? "0"
    ),
    bytesReceived: Number(
      (await locator.getAttribute("data-bytes-received")) ?? "0"
    )
  };
}

test("P0-l proves live source-selective SFU routing across three browsers", async ({
  browser
}, testInfo) => {
  const humans: HumanBrowser[] = [];

  try {
    const alice = await newHuman(browser, "Alice");
    humans.push(alice);
    const bob = await newHuman(browser, "Bob");
    humans.push(bob);
    const charlie = await newHuman(browser, "Charlie");
    humans.push(charlie);

    await joinGroup(alice);
    await joinGroup(bob);
    await joinGroup(charlie);

    await alice.page.getByTestId("publish-microphone").click();
    await expect(
      sourceRow(bob.page, "human-microphone", "Alice")
    ).toBeVisible();

    await alice.page.getByTestId("publish-sound-effects").click();
    await expect(
      sourceRow(charlie.page, "sound-effect", "Alice")
    ).toBeVisible();

    const bobMic = subscriptionButton(
      bob.page,
      "human-microphone",
      "Alice"
    );
    const bobFx = subscriptionButton(
      bob.page,
      "sound-effect",
      "Alice"
    );
    const charlieMic = subscriptionButton(
      charlie.page,
      "human-microphone",
      "Alice"
    );
    const charlieFx = subscriptionButton(
      charlie.page,
      "sound-effect",
      "Alice"
    );

    await bobMic.click();
    await charlieFx.click();

    const bobMicConsumer = consumerCard(
      bob.page,
      "human-microphone",
      "Alice"
    );
    const bobFxConsumer = consumerCard(
      bob.page,
      "sound-effect",
      "Alice"
    );
    const charlieMicConsumer = consumerCard(
      charlie.page,
      "human-microphone",
      "Alice"
    );
    const charlieFxConsumer = consumerCard(
      charlie.page,
      "sound-effect",
      "Alice"
    );

    await expectPackets(bobMicConsumer);
    await expect(charlieFxConsumer).toHaveCount(1);

    // Drive actual Web Audio into Alice's governed sound-effect Producer.
    await alice.page.getByTestId("trigger-sound-effect").click();
    await expectPackets(charlieFxConsumer);

    // The negative half of the matrix is just as important: no subscription,
    // no Consumer, therefore no receive-side RTP stats surface.
    await expect(bobFxConsumer).toHaveCount(0);
    await expect(charlieMicConsumer).toHaveCount(0);

    const initialEvidence = {
      bob: {
        microphone: await evidence(bobMicConsumer),
        soundEffectConsumerCount: await bobFxConsumer.count()
      },
      charlie: {
        microphoneConsumerCount: await charlieMicConsumer.count(),
        soundEffect: await evidence(charlieFxConsumer)
      }
    };

    // Live mutation proof: destroy one exact Consumer and create two others
    // without rejoining the room or restarting the SFU.
    await bobMic.click();
    await expect(bobMicConsumer).toHaveCount(0);

    await charlieMic.click();
    await expectPackets(charlieMicConsumer);

    await bobFx.click();
    await expect(bobFxConsumer).toHaveCount(1);
    await alice.page.getByTestId("trigger-sound-effect").click();
    await expectPackets(bobFxConsumer);

    await charlieFx.click();
    await expect(charlieFxConsumer).toHaveCount(0);

    const finalEvidence = {
      bob: {
        microphoneConsumerCount: await bobMicConsumer.count(),
        soundEffect: await evidence(bobFxConsumer)
      },
      charlie: {
        microphone: await evidence(charlieMicConsumer),
        soundEffectConsumerCount: await charlieFxConsumer.count()
      }
    };

    const report = {
      schema: "p0-l.acceptance.1",
      test: testInfo.title,
      generatedAt: new Date().toISOString(),
      matrix: {
        initial: {
          bob: ["Alice:human-microphone"],
          charlie: ["Alice:sound-effect"]
        },
        final: {
          bob: ["Alice:sound-effect"],
          charlie: ["Alice:human-microphone"]
        }
      },
      initialEvidence,
      finalEvidence
    };

    const reportPath = resolve(
      "test-results",
      "p0l-media-acceptance.json"
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );

    await testInfo.attach("p0l-media-acceptance", {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json"
    });
  } finally {
    await Promise.all(
      humans.map((human) => human.context.close())
    );
  }
});
