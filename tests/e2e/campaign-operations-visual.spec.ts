import { expect, test } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

async function signIn(page: import("@playwright/test").Page) {
  await waitForLoginHydration(page);
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.describe("campaign operations visual and recovery acceptance", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");

  test("renders the operations workspace at supported desktop, tablet and mobile widths", async ({ page }, testInfo) => {
    await signIn(page);
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/dashboard/campaigns");
      const panel = page.getByLabel("Campaign operations workspace");
      await expect(panel).toBeVisible();
      await expect(panel.getByText("SIMULATION ONLY", { exact: true })).toBeVisible();
      await expect(panel.getByLabel("Operations campaign")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`campaign-operations-${viewport.width}.png`), fullPage: true });
    }
  });

  test("supports keyboard focus, failed refresh recovery and zero-eligible fail-closed messaging", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/campaigns");
    const panel = page.getByLabel("Campaign operations workspace");
    const campaignSelect = panel.getByLabel("Operations campaign");
    await campaignSelect.focus();
    await expect(campaignSelect).toBeFocused();

    let failNext = true;
    await page.route("**/api/campaigns/*/simulation-preflight", async (route) => {
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Readiness temporarily unavailable." }) });
      } else {
        await route.continue();
      }
    });
    await campaignSelect.selectOption(process.env.E2E_CAMPAIGN_A!);
    await expect(panel.getByRole("alert")).toContainText("Readiness temporarily unavailable");
    await panel.getByRole("button", { name: "Retry readiness" }).click();
    await expect(panel.getByText("Ready for offline simulation", { exact: false })).toBeVisible();

    const preflight = await page.request.get(`/api/campaigns/${process.env.E2E_CAMPAIGN_A}/simulation-preflight`);
    expect(preflight.ok()).toBeTruthy();
    const body = await preflight.json();
    body.contacts = body.contacts.map((contact: Record<string, unknown>) => ({ ...contact, eligible: false, consent_status: "unknown", opted_out_at: null, reason: "Consent is unknown." }));
    body.counts = { selected: body.contacts.length, eligible: 0, excluded: body.contacts.length };
    await page.route("**/api/campaigns/*/simulation-preflight", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
    await panel.getByRole("button", { name: "Refresh readiness" }).click();
    await expect(panel.getByText("Not ready for offline simulation", { exact: false })).toBeVisible();
    await expect(panel.getByText("No eligible contacts are available for simulation.", { exact: true })).toBeVisible();
  });
});
