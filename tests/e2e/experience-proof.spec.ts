import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

interface HumanBrowser {
  name: string;
  context: BrowserContext;
  page: Page;
}

type SourceKind = "human-microphone" | "sound-effect";

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
    human.page.getByRole("button", { name: "Publish microphone" })
  ).toBeVisible();
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

function consumerCard(
  page: Page,
  kind: SourceKind,
  ownerName: string
) {
  return page.locator(
    `[data-acceptance-consumer="true"][data-source-kind="${kind}"][data-owner-name="${ownerName}"]`
  );
}

async function packetCount(locator: Locator) {
  return Number(
    (await locator.getAttribute("data-packets-received")) ?? "0"
  );
}

async function expectPackets(locator: Locator) {
  await expect(locator).toHaveCount(1);
  await expect
    .poll(async () => packetCount(locator), {
      timeout: 15_000
    })
    .toBeGreaterThan(0);
}

test("P0-t proves concurrent work, explicit acceptance, and selective resumption as one experience", async ({
  browser
}, testInfo) => {
  const humans: HumanBrowser[] = [];

  try {
    const alice = await newHuman(browser, "Alice");
    humans.push(alice);
    const bob = await newHuman(browser, "Bob");
    humans.push(bob);

    const workerProfile = alice.page.getByTestId("silent-worker-profile");
    await expect(workerProfile).toBeVisible();
    await expect(workerProfile).toContainText("MODE MOCK");
    await expect(workerProfile).toContainText("TOOLS OFF");
    await expect(workerProfile).toContainText("INPUT WORK-PROMPT-ONLY");

    await joinGroup(alice);
    await joinGroup(bob);

    // Human conversation path is already live before bounded work starts.
    await alice.page.getByTestId("publish-microphone").click();
    const aliceMicSubscription = subscriptionButton(
      bob.page,
      "human-microphone",
      "Alice"
    );
    await expect(aliceMicSubscription).toBeVisible();
    await aliceMicSubscription.click();

    const bobAliceMicConsumer = consumerCard(
      bob.page,
      "human-microphone",
      "Alice"
    );
    await expectPackets(bobAliceMicConsumer);

    // P0 includes one participant-owned sound cue. It travels through the same
    // governed source/subscription boundary rather than hiding in the mic.
    await alice.page.getByTestId("publish-sound-effects").click();
    const aliceFxSubscription = subscriptionButton(
      bob.page,
      "sound-effect",
      "Alice"
    );
    await expect(aliceFxSubscription).toBeVisible();
    await aliceFxSubscription.click();

    const bobAliceFxConsumer = consumerCard(
      bob.page,
      "sound-effect",
      "Alice"
    );
    await expect(bobAliceFxConsumer).toHaveCount(1);
    await alice.page.getByTestId("trigger-sound-effect").click();
    await expectPackets(bobAliceFxConsumer);
    const cuePackets = await packetCount(bobAliceFxConsumer);

    const packetsBeforeWork = await packetCount(bobAliceMicConsumer);

    // Bob has SUBMIT_WORK but not ACCEPT_OUTCOME. The agent works silently
    // while Alice's human microphone RTP continues flowing to Bob.
    const task =
      "Compare two approaches while this live human conversation continues.";
    await bob.page.getByLabel("Agent task").fill(task);
    await bob.page.getByTestId("submit-governed-work").click();

    const bobWork = bob.page
      .getByTestId("work-item")
      .filter({ hasText: task });
    await expect(bobWork).toBeVisible();

    const aliceArtifact = alice.page
      .getByTestId("proposal-artifact")
      .filter({ hasText: "Comparison artifact" });
    await expect(aliceArtifact).toBeVisible();

    await expect
      .poll(async () => packetCount(bobAliceMicConsumer), {
        timeout: 15_000
      })
      .toBeGreaterThan(packetsBeforeWork);

    const packetsAfterWork = await packetCount(bobAliceMicConsumer);

    // The proposal is visible but is not a durable accepted outcome yet.
    const bobArtifact = bob.page
      .getByTestId("proposal-artifact")
      .filter({ hasText: "Comparison artifact" });
    await expect(bobArtifact).toHaveAttribute(
      "data-artifact-status",
      "proposed"
    );
    const bobAccept = bobArtifact.getByTestId("accept-proposal");
    await expect(bobAccept).toBeDisabled();
    await expect(bobAccept).toContainText("ACCEPT_OUTCOME grant required");

    // Alice owns ACCEPT_OUTCOME and performs the explicit durable transition.
    const aliceAccept = aliceArtifact.getByTestId("accept-proposal");
    await expect(aliceAccept).toBeEnabled();
    await aliceAccept.click();

    await expect(alice.page.getByTestId("latest-acceptance")).toBeVisible();
    await expect(aliceArtifact).toHaveAttribute(
      "data-artifact-status",
      "accepted"
    );
    await expect(bobArtifact).toHaveAttribute(
      "data-artifact-status",
      "accepted"
    );

    // Everyone leaves. Alice leaves first so Bob's later leave is a durable
    // missed event that Alice can receive when she resumes.
    await alice.page.getByRole("button", { name: "Leave episode" }).click();
    await expect(
      alice.page.getByTestId("authenticate-join")
    ).toBeVisible();

    await bob.page.getByRole("button", { name: "Leave episode" }).click();
    await expect(
      bob.page.getByTestId("authenticate-join")
    ).toBeVisible();

    // Same stable Alice identity rejoins. P0-r derives continuity from durable
    // state; P0-s restricts the event delta to Alice's membership history.
    await alice.page.getByTestId("authenticate-join").click();
    await expect(
      alice.page.getByRole("button", { name: "Leave episode" })
    ).toBeVisible();

    const resumeBrief = alice.page.getByTestId("resumption-brief");
    await expect(resumeBrief).toBeVisible();
    await expect(
      alice.page.getByTestId("resumption-accepted-work")
    ).toContainText("Comparison artifact");
    await expect(
      alice.page.getByTestId("resumption-unresolved-work")
    ).toContainText("No unresolved bounded work");
    await expect(
      alice.page.getByTestId("resumption-next-action")
    ).toContainText("No unresolved bounded work remains");
    await expect(
      alice.page.getByTestId("resumption-missed-events")
    ).toContainText("Bob left the live episode");

    // The compact continuity surface deliberately does not duplicate the
    // artifact body or reconstruct live speech.
    await expect(
      alice.page.getByTestId("resumption-accepted-work")
    ).not.toContainText("P0 mock result");

    const report = {
      schema: "p0-t.experience-proof.1",
      test: testInfo.title,
      generatedAt: new Date().toISOString(),
      participants: ["Alice", "Bob"],
      concurrentMedia: {
        source: "Alice:human-microphone",
        packetsBeforeWork,
        packetsAfterWork,
        continuedDuringAgentWork: packetsAfterWork > packetsBeforeWork
      },
      participantOwnedCue: {
        source: "Alice:sound-effect",
        deliveredPackets: cuePackets
      },
      authoritySplit: {
        bobCouldSubmitWork: true,
        bobCouldAcceptOutcome: false,
        aliceAcceptedOutcome: true
      },
      durableOutcome: {
        title: "Comparison artifact",
        resumedAsAcceptedWork: true
      },
      resumption: {
        unresolvedWork: 0,
        nextAction: "submit-work",
        observedMissedEvent: "Bob left the live episode"
      },
      boundary: {
        transcriptReconstructionUsed: false,
        artifactBodyDuplicatedIntoCompactBrief: false
      }
    };

    const reportPath = resolve(
      "test-results",
      "p0t-experience-proof.json"
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );

    await testInfo.attach("p0t-experience-proof", {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json"
    });
  } finally {
    await Promise.all(
      humans.map((human) => human.context.close())
    );
  }
});
