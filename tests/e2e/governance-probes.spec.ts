import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

interface HumanBrowser {
  context: BrowserContext;
  page: Page;
}

async function newHuman(
  browser: Browser,
  name: string,
  role: "participant" | "observer" = "participant"
): Promise<HumanBrowser> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Requested room role").selectOption(role);
  await page.getByTestId("authenticate-join").click();
  await expect(
    page.getByRole("button", { name: "Leave episode" })
  ).toBeVisible();

  return { context, page };
}

test("P0-v closes speaking, history, delegation, and effect governance probes", async ({
  browser
}, testInfo) => {
  const alice = await newHuman(browser, "Alice");
  let observer: HumanBrowser | null = null;

  try {
    const task =
      "Prepare one artifact so the external-effect firewall can be probed.";
    await alice.page.getByLabel("Agent task").fill(task);
    await alice.page.getByTestId("submit-governed-work").click();

    const artifact = alice.page
      .getByTestId("proposal-artifact")
      .filter({ hasText: "Comparison artifact" });
    await expect(artifact).toBeVisible();

    const accept = artifact.getByTestId("accept-proposal");
    await expect(accept).toBeEnabled();
    await accept.click();

    await expect(artifact).toHaveAttribute(
      "data-artifact-status",
      "accepted"
    );
    await expect(
      alice.page.getByTestId("latest-acceptance")
    ).toBeVisible();

    // A brand-new observer joins only after durable room activity exists.
    // P0-s allows current room state but withholds pre-membership event replay.
    observer = await newHuman(browser, "Late Observer", "observer");

    const observerBrief = observer.page.getByTestId("resumption-brief");
    await expect(observerBrief).toBeVisible();
    await expect(observerBrief).toContainText("MISSED 0");
    await expect(
      observer.page.getByTestId("resumption-missed-events")
    ).toContainText("No missed durable events");

    // Observer membership carries READ_ROOM_STATE only. The normal media
    // admission control is therefore disabled before a publish path exists.
    const observerGroupJoin = observer.page.getByTestId("join-group-media");
    await expect(observerGroupJoin).toBeDisabled();

    // P0-v: room access and accepted context still do not authorize onward
    // delegation. The local proof executor must remain behind its own grant.
    const delegationProbe = artifact.getByTestId(
      "probe-context-delegation"
    );
    await expect(delegationProbe).toBeEnabled();
    await delegationProbe.click();

    const delegationStatus = artifact.getByTestId(
      "context-delegation-status"
    );
    await expect(delegationStatus).toBeVisible();
    await expect(delegationStatus).toHaveAttribute(
      "data-delegation-state",
      "blocked"
    );
    await expect(delegationStatus).toHaveAttribute(
      "data-delegation-error",
      "NOT_AUTHORIZED"
    );
    await expect(delegationStatus).toContainText(
      "local-delegation-proof-sink"
    );
    await expect(delegationStatus).toContainText(
      "no-delegation-grant"
    );

    // P0 deliberately issues no EXECUTE_EXTERNAL_EFFECT grant. Acceptance is
    // durable publication authority only, so the executor must not run.
    const probe = artifact.getByTestId("probe-external-effect");
    await expect(probe).toBeEnabled();
    await probe.click();

    const status = artifact.getByTestId("external-effect-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute(
      "data-effect-state",
      "blocked"
    );
    await expect(status).toHaveAttribute(
      "data-effect-error",
      "NOT_AUTHORIZED"
    );
    await expect(status).toContainText("demo-marker");
    await expect(status).toContainText("local-proof-sink");
    await expect(status).toContainText("no-execution-grant");

    const report = {
      schema: "p0-v.governance-closure.1",
      test: testInfo.title,
      generatedAt: new Date().toISOString(),
      probes: {
        speaking: {
          subject: "Late Observer",
          expected: "blocked",
          evidence: "group media admission disabled without SPEAK or RECEIVE_MEDIA"
        },
        history: {
          subject: "Late Observer",
          expected: "no pre-membership replay",
          missedDurableEvents: 0
        },
        delegation: {
          subject: "Alice",
          expected: "blocked",
          code: "NOT_AUTHORIZED",
          target: "local-delegation-proof-sink"
        },
        externalEffect: {
          subject: "Alice",
          expected: "blocked",
          code: "NOT_AUTHORIZED",
          target: "local-proof-sink"
        }
      }
    };

    const reportPath = resolve(
      "test-results",
      "p0v-governance-closure.json"
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );

    await testInfo.attach("p0v-governance-closure", {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json"
    });
  } finally {
    await Promise.all([
      alice.context.close(),
      observer?.context.close() ?? Promise.resolve()
    ]);
  }
});
