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

test.describe("authenticated campaign readiness", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");

  test("owner sees tenant-scoped hypothetical readiness without sensitive data", async ({ page }) => {
    await signIn(page);
    const campaignsLoaded = page.waitForResponse((response) => response.url().endsWith("/api/campaigns") && response.ok());
    await page.goto("/dashboard/campaigns");
    await campaignsLoaded;
    await expect(page.getByLabel("Simulation campaign")).toBeVisible({ timeout: 15000 });
    await page.getByLabel("Simulation campaign").selectOption(process.env.E2E_CAMPAIGN_A!);
    await page.getByRole("button", { name: "Preview readiness" }).click();
    const contactsResponse = await page.request.get("/api/contacts");
    expect(contactsResponse.ok()).toBeTruthy();
    const contactsBody = await contactsResponse.json();
    expect(contactsBody.contacts).toHaveLength(5);
    await expect(page.getByRole("status")).toContainText("2 eligible");
    await expect(page.getByRole("status")).toContainText("1 unknown consent");
    await expect(page.getByRole("status")).toContainText("2 opted out/revoked");
    await expect(page.getByText(/organization-wide hypothetical contact pool/i)).toBeVisible();
    await expect(page.getByText(/selections are session-local and never saved/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /start live|place call|dispatch/i })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("+15550000001");
  });

  test("campaign operations panel shows readiness and keeps audience selection session-local", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/campaigns");
    const panel = page.getByLabel("Campaign operations workspace");
    await panel.getByLabel("Operations campaign").selectOption(process.env.E2E_CAMPAIGN_A!);
    await expect(panel.getByText("Readiness at a glance")).toBeVisible();
    await expect(panel.getByText("Eligible", { exact: true })).toBeVisible();
    await expect(panel.getByText("Unverified consent", { exact: true })).toBeVisible();
    await expect(panel.getByText(/Selections reset on reload/i)).toBeVisible();
    await panel.getByRole("button", { name: "Clear" }).click();
    await expect(panel.getByText("Selected 0 of 5")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Review and rehearse" })).toHaveAttribute("href", /campaign=/);
    await page.reload();
    await expect(page.getByLabel("Campaign operations workspace").getByLabel("Operations campaign")).toHaveValue("");
  });

  test("cross-tenant campaign preflight is denied", async ({ page }) => {
    await signIn(page);
    const status = await page.evaluate(async (campaignId) => (await fetch(`/api/campaigns/${campaignId}/simulation-preflight`, { cache: "no-store" })).status, process.env.E2E_CAMPAIGN_B ?? "00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });

  test("refresh rejects a contact whose consent changed after selection", async ({ page }) => {
    await signIn(page);
    try {
      const campaignsLoaded = page.waitForResponse((response) => response.url().endsWith("/api/campaigns") && response.ok());
      await page.goto("/dashboard/campaigns");
      await campaignsLoaded;
      await expect(page.getByRole("heading", { name: "Campaign workspace" })).toBeVisible();
      await expect(page.getByLabel("Simulation campaign")).toBeVisible({ timeout: 15000 });
      await page.getByLabel("Simulation campaign").selectOption(process.env.E2E_CAMPAIGN_A!);
      await expect(page.getByRole("button", { name: "Preview readiness" })).toBeVisible({ timeout: 15000 });
      await page.getByRole("button", { name: "Preview readiness" }).click();
      await expect(page.getByRole("status")).toContainText("2 eligible");
      const patchStatus = await page.evaluate(async (contactId) => (await fetch(`/api/contacts/${contactId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent_status: "revoked" }) })).status, process.env.E2E_CONTACT_A!);
      expect(patchStatus).toBe(200);
      await page.getByRole("button", { name: "Refresh authorization" }).click();
      await expect(page.getByRole("status")).toContainText("1 eligible");
      await expect(page.getByRole("status")).toContainText("3 opted out/revoked");
    } finally {
      const restore = await page.request.patch(`/api/contacts/${process.env.E2E_CONTACT_A}`, { data: { consent_status: "granted" } });
      expect(restore.status()).toBe(200);
    }
  });
});
