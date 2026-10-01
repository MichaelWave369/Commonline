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

type SourceKind = "human-microphone" | "sound-effect" | "agent-voice";

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

async function waitForPacketQuiescence(
  locator: Locator,
  options: {
    quietMs?: number;
    sampleMs?: number;
    timeoutMs?: number;
  } = {}
) {
  const quietMs = options.quietMs ?? 600;
  const sampleMs = options.sampleMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startedAt = Date.now();
  let lastPackets = Number(
    (await locator.getAttribute("data-packets-received")) ?? "0"
  );
  let stableSince = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, sampleMs));
    const packets = Number(
      (await locator.getAttribute("data-packets-received")) ?? "0"
    );

    if (packets !== lastPackets) {
      lastPackets = packets;
      stableSince = Date.now();
      continue;
    }

    if (Date.now() - stableSince >= quietMs) {
      return packets;
    }
  }

  throw new Error(
    `RTP packet counter did not become quiescent within ${timeoutMs}ms`
  );
}

test("P0-q proves heard context stays silent until separately authorized reply", async ({
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

    // P0-n: authority must exist before renderer capability can create
    // an agent-owned source. Alice is the original steward in this fresh room.
    await alice.page.getByTestId("bootstrap-voice-authority").click();
    await expect(
      alice.page.getByTestId("grant-vessie-voice")
    ).toBeVisible();
    await alice.page.getByTestId("grant-vessie-voice").click();

    const bobVoiceSource = sourceRow(
      bob.page,
      "agent-voice",
      "Vessie"
    );
    const charlieVoiceSource = sourceRow(
      charlie.page,
      "agent-voice",
      "Vessie"
    );
    await expect(bobVoiceSource).toBeVisible();
    await expect(charlieVoiceSource).toBeVisible();

    const bobVoiceSubscription = subscriptionButton(
      bob.page,
      "agent-voice",
      "Vessie"
    );
    const charlieVoiceConsumer = consumerCard(
      charlie.page,
      "agent-voice",
      "Vessie"
    );
    const bobVoiceConsumer = consumerCard(
      bob.page,
      "agent-voice",
      "Vessie"
    );

    await bobVoiceSubscription.click();
    await expect(bobVoiceConsumer).toHaveCount(1);
    await expect(charlieVoiceConsumer).toHaveCount(0);

    await expect(
      alice.page.getByTestId("request-vessie-voice")
    ).toBeEnabled();
    await alice.page.getByTestId("request-vessie-voice").click();

    await expect
      .poll(
        async () =>
          (await alice.page
            .getByTestId("agent-voice-utterance-status")
            .getAttribute("data-utterance-state")) ?? "",
        {
          timeout: 20_000,
          message: "expected governed Vessie utterance to complete"
        }
      )
      .toBe("completed");

    await expectPackets(bobVoiceConsumer);
    await expect(charlieVoiceConsumer).toHaveCount(0);

    const agentVoiceEvidence = {
      bob: await evidence(bobVoiceConsumer),
      charlieConsumerCount: await charlieVoiceConsumer.count()
    };

    // P0-o: voice authority alone is not permission to take the floor.
    // Alice grants one ephemeral turn, which must be consumed exactly once.
    const beforeFirstTurnPackets = Number(
      (await bobVoiceConsumer.getAttribute("data-packets-received")) ?? "0"
    );

    await alice.page.getByTestId("grant-attention-lease").click();
    const attentionState = alice.page.getByTestId("attention-lease-state");
    await expect(attentionState).toHaveAttribute(
      "data-attention-state",
      "active"
    );
    const firstLeaseId =
      (await attentionState.getAttribute("data-attention-lease-id")) ?? "";
    expect(firstLeaseId).not.toBe("");

    await alice.page
      .getByTestId("agent-turn-prompt")
      .fill("Confirm this one-turn attention lease was consumed.");
    await alice.page.getByTestId("request-agent-turn").click();

    await expect
      .poll(
        async () =>
          (await alice.page
            .getByTestId("agent-turn-status")
            .getAttribute("data-turn-state")) ?? "",
        {
          timeout: 20_000,
          message: "expected attention-leased Vessie turn to complete"
        }
      )
      .toBe("completed");

    await expect(attentionState).toHaveAttribute(
      "data-attention-state",
      "consumed"
    );
    await expect
      .poll(
        async () =>
          Number(
            (await bobVoiceConsumer.getAttribute(
              "data-packets-received"
            )) ?? "0"
          ),
        {
          timeout: 20_000,
          message: "expected new RTP after the leased agent turn"
        }
      )
      .toBeGreaterThan(beforeFirstTurnPackets);
    await expect(charlieVoiceConsumer).toHaveCount(0);

    const firstAttentionEvidence = {
      leaseId: firstLeaseId,
      leaseState:
        await attentionState.getAttribute("data-attention-state"),
      bob: await evidence(bobVoiceConsumer),
      charlieConsumerCount: await charlieVoiceConsumer.count()
    };

    // A consumed lease cannot expose another request control. A new explicit
    // human grant creates a distinct lease before Vessie may take another turn.
    await expect(
      alice.page.getByTestId("request-agent-turn")
    ).toHaveCount(0);
    await alice.page.getByTestId("grant-attention-lease").click();
    await expect(attentionState).toHaveAttribute(
      "data-attention-state",
      "active"
    );
    const secondLeaseId =
      (await attentionState.getAttribute("data-attention-lease-id")) ?? "";
    expect(secondLeaseId).not.toBe("");
    expect(secondLeaseId).not.toBe(firstLeaseId);

    const beforeSecondTurnPackets = Number(
      (await bobVoiceConsumer.getAttribute("data-packets-received")) ?? "0"
    );
    await alice.page
      .getByTestId("agent-turn-prompt")
      .fill("Use the newly granted one-turn lease.");
    await alice.page.getByTestId("request-agent-turn").click();

    await expect
      .poll(
        async () =>
          (await alice.page
            .getByTestId("agent-turn-status")
            .getAttribute("data-turn-state")) ?? "",
        {
          timeout: 20_000,
          message: "expected second explicitly leased turn to complete"
        }
      )
      .toBe("completed");
    await expect(attentionState).toHaveAttribute(
      "data-attention-state",
      "consumed"
    );
    await expect
      .poll(
        async () =>
          Number(
            (await bobVoiceConsumer.getAttribute(
              "data-packets-received"
            )) ?? "0"
          ),
        {
          timeout: 20_000,
          message: "expected RTP only after a new attention lease"
        }
      )
      .toBeGreaterThan(beforeSecondTurnPackets);

    const secondAttentionEvidence = {
      leaseId: secondLeaseId,
      leaseState:
        await attentionState.getAttribute("data-attention-state"),
      bob: await evidence(bobVoiceConsumer),
      charlieConsumerCount: await charlieVoiceConsumer.count()
    };

    // The previous authorized Vessie turn may still have a few RTP packets in
    // flight after its application-level state reaches completed. Wait for the
    // consumer counter to become quiet before establishing the P0-q baseline so
    // late packets from that permitted turn cannot be misattributed to hearing.
    const beforeListeningPackets =
      await waitForPacketQuiescence(bobVoiceConsumer);

    // P0-p: Vessie still has no ambient microphone route. Alice explicitly
    // arms one bounded share, captures a short fake-mic segment, and submits it
    // to local STT as ephemeral selected context.
    await alice.page.getByTestId("grant-listening-share").click();
    const listeningLease = alice.page.getByTestId(
      "listening-lease-state"
    );
    await expect(listeningLease).toHaveAttribute(
      "data-listening-state",
      "active"
    );

    await alice.page.getByTestId("start-listening-share").click();
    await alice.page.waitForTimeout(750);
    await alice.page.getByTestId("stop-listening-share").click();

    const listeningResult = alice.page.getByTestId(
      "listening-share-result"
    );
    await expect(listeningResult).toBeVisible();
    await expect(listeningResult).toHaveAttribute(
      "data-stt-engine",
      "deterministic"
    );

    const sharedSamples = Number(
      (await listeningResult.getAttribute("data-sample-count")) ?? "0"
    );
    const sharedDurationMs = Number(
      (await listeningResult.getAttribute("data-duration-ms")) ?? "0"
    );
    expect(sharedSamples).toBeGreaterThanOrEqual(1600);
    expect(sharedSamples).toBeLessThanOrEqual(80000);
    expect(sharedDurationMs).toBeGreaterThanOrEqual(100);
    expect(sharedDurationMs).toBeLessThanOrEqual(5000);
    await expect(listeningResult).toContainText(
      "bounded listening share received"
    );

    await expect(listeningLease).toHaveAttribute(
      "data-listening-state",
      "consumed"
    );

    // Transcript content is returned only to the sharing human. Other room
    // participants see content-free transparency status, not the transcript.
    await expect(
      bob.page.getByTestId("listening-share-result")
    ).toHaveCount(0);
    await expect(
      charlie.page.getByTestId("listening-share-result")
    ).toHaveCount(0);

    await expect(
      bob.page.getByTestId("listening-share-status")
    ).toHaveAttribute("data-listening-status", "delivered");
    await expect(
      charlie.page.getByTestId("listening-share-status")
    ).toHaveAttribute("data-listening-status", "delivered");

    // A consumed listening lease cannot capture again without a new explicit grant.
    await expect(
      alice.page.getByTestId("start-listening-share")
    ).toHaveCount(0);
    await expect(
      alice.page.getByTestId("grant-listening-share")
    ).toBeVisible();

    const listeningEvidence = {
      leaseState:
        await listeningLease.getAttribute("data-listening-state"),
      engine:
        await listeningResult.getAttribute("data-stt-engine"),
      sampleCount: sharedSamples,
      durationMs: sharedDurationMs,
      bobTranscriptCount:
        await bob.page.getByTestId("listening-share-result").count(),
      charlieTranscriptCount:
        await charlie.page.getByTestId("listening-share-result").count(),
      bobStatus:
        await bob.page
          .getByTestId("listening-share-status")
          .getAttribute("data-listening-status"),
      charlieStatus:
        await charlie.page
          .getByTestId("listening-share-status")
          .getAttribute("data-listening-status")
    };

    // P0-q: hearing alone does not create speech. The existing Vessie
    // subscription must stay packet-stable until Alice separately grants a
    // fresh attention turn and explicitly binds it to this heard exchange.
    const exchange = alice.page.getByTestId("conversation-exchange");
    await expect(exchange).toHaveAttribute("data-exchange-state", "heard");
    const exchangeId =
      (await exchange.getAttribute("data-exchange-id")) ?? "";
    expect(exchangeId).not.toBe("");

    await alice.page.waitForTimeout(350);
    const afterListeningPackets = Number(
      (await bobVoiceConsumer.getAttribute("data-packets-received")) ?? "0"
    );
    expect(afterListeningPackets).toBe(beforeListeningPackets);

    await expect(
      alice.page.getByTestId("authorize-exchange-response")
    ).toHaveCount(0);
    await alice.page.getByTestId("grant-exchange-attention").click();
    await expect(attentionState).toHaveAttribute(
      "data-attention-state",
      "active"
    );
    const exchangeAttentionLeaseId =
      (await attentionState.getAttribute("data-attention-lease-id")) ?? "";
    expect(exchangeAttentionLeaseId).not.toBe("");
    expect(exchangeAttentionLeaseId).not.toBe(secondLeaseId);

    await alice.page.getByTestId("authorize-exchange-response").click();

    const exchangeStatus = alice.page.getByTestId(
      "exchange-response-status"
    );
    await expect
      .poll(
        async () =>
          (await exchangeStatus.getAttribute("data-response-state")) ?? "",
        {
          timeout: 20_000,
          message:
            "expected separately attention-authorized exchange reply to complete"
        }
      )
      .toBe("completed");

    await expect(exchangeStatus).toHaveAttribute(
      "data-exchange-id",
      exchangeId
    );
    await expect(exchangeStatus).toHaveAttribute(
      "data-exchange-state",
      "responded"
    );
    await expect(attentionState).toHaveAttribute(
      "data-attention-state",
      "consumed"
    );

    await expect
      .poll(
        async () =>
          Number(
            (await bobVoiceConsumer.getAttribute(
              "data-packets-received"
            )) ?? "0"
          ),
        {
          timeout: 20_000,
          message:
            "expected Vessie RTP only after heard exchange received separate attention authority"
        }
      )
      .toBeGreaterThan(afterListeningPackets);
    await expect(charlieVoiceConsumer).toHaveCount(0);

    await expect(exchange).toHaveAttribute(
      "data-exchange-state",
      "responded"
    );
    await expect(
      alice.page.getByTestId("authorize-exchange-response")
    ).toHaveCount(0);

    const exchangeEvidence = {
      exchangeId,
      exchangeState:
        await exchange.getAttribute("data-exchange-state"),
      attentionLeaseId: exchangeAttentionLeaseId,
      attentionState:
        await attentionState.getAttribute("data-attention-state"),
      packetsBeforeListening: beforeListeningPackets,
      packetsAfterListening: afterListeningPackets,
      bobAfterReply: await evidence(bobVoiceConsumer),
      charlieConsumerCount: await charlieVoiceConsumer.count()
    };

    // Revocation must remove the source and downstream Consumer, not merely
    // hide a button while audio authority remains alive.
    await alice.page.getByTestId("revoke-vessie-voice").click();
    await expect(bobVoiceSource).toHaveCount(0);
    await expect(bobVoiceConsumer).toHaveCount(0);

    const report = {
      schema: "p0-q.acceptance.1",
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
      finalEvidence,
      agentVoiceEvidence,
      attentionTurns: {
        first: firstAttentionEvidence,
        second: secondAttentionEvidence
      },
      listeningEvidence,
      exchangeEvidence,
      agentVoiceRevoked: {
        sourceCount: await bobVoiceSource.count(),
        consumerCount: await bobVoiceConsumer.count()
      }
    };

    const reportPath = resolve(
      "test-results",
      "p0q-media-acceptance.json"
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );

    await testInfo.attach("p0q-media-acceptance", {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json"
    });
  } finally {
    await Promise.all(
      humans.map((human) => human.context.close())
    );
  }
});
