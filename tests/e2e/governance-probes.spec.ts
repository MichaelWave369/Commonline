import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

interface HumanBrowser {
  context: BrowserContext;
  page: Page;
}

async function newHuman(
  browser: Browser,
  name: string
): Promise<HumanBrowser> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/");
  await page.getByLabel("Display name").fill(name);
  await page.getByTestId("authenticate-join").click();
  await expect(
    page.getByRole("button", { name: "Leave episode" })
  ).toBeVisible();

  return { context, page };
}

test("P0-u proves accepted work cannot authorize an external effect", async ({
  browser
}) => {
  const alice = await newHuman(browser, "Alice");

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
  } finally {
    await alice.context.close();
  }
});
