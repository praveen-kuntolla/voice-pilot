import { expect, test } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test.describe("authenticated campaign readiness", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");
  test("owner sees tenant-scoped hypothetical readiness without sensitive data", async ({ page }) => {
    await waitForLoginHydration(page);
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard/);
    const campaignsLoaded = page.waitForResponse((response) => response.url().endsWith("/api/campaigns") && response.ok());
    await page.goto("/dashboard/campaigns");
    await campaignsLoaded;
    await expect(page.getByLabel("Simulation campaign")).toBeVisible({ timeout: 15000 });
    await page.getByLabel("Simulation campaign").selectOption(process.env.E2E_CAMPAIGN_A!);
    await page.getByRole("button", { name: "Preview readiness" }).click();
    const contactsResponse = await page.request.get("/api/contacts");
    expect(contactsResponse.ok()).toBeTruthy();
    const contactsBody = await contactsResponse.json();
    expect(contactsBody.contacts).toHaveLength(4);
    await expect(page.getByRole("status")).toContainText("1 eligible");
    await expect(page.getByRole("status")).toContainText("1 unknown consent");
    await expect(page.getByRole("status")).toContainText("2 opted out/revoked");
    await expect(page.getByText(/organization-wide hypothetical contact pool/i)).toBeVisible();
    await expect(page.getByText(/selections are session-local and never saved/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /start live|place call|dispatch/i })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("+15550000001");
  });
  test("cross-tenant campaign preflight is denied", async ({ page }) => {
    await waitForLoginHydration(page);
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard/);
    const status = await page.evaluate(async (campaignId) => (await fetch(`/api/campaigns/${campaignId}/simulation-preflight`, { cache: "no-store" })).status, process.env.E2E_CAMPAIGN_B ?? "00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });
  test("refresh rejects a contact whose consent changed after selection", async ({ page }) => {
    await waitForLoginHydration(page);
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard/);
    const campaignsLoaded = page.waitForResponse((response) => response.url().endsWith("/api/campaigns") && response.ok());
    await page.goto("/dashboard/campaigns");
    await campaignsLoaded;
    await expect(page.getByRole("heading", { name: "Campaign workspace" })).toBeVisible();
    await expect(page.getByLabel("Simulation campaign")).toBeVisible({ timeout: 15000 });
    await page.getByLabel("Simulation campaign").selectOption(process.env.E2E_CAMPAIGN_A!);
    await expect(page.getByRole("button", { name: "Preview readiness" })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Preview readiness" }).click();
    await expect(page.getByRole("status")).toContainText("1 eligible");
    const patchStatus = await page.evaluate(async (contactId) => (await fetch(`/api/contacts/${contactId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent_status: "revoked" }) })).status, process.env.E2E_CONTACT_A!);
    expect(patchStatus).toBe(200);
    await page.getByRole("button", { name: "Refresh authorization" }).click();
    await expect(page.getByRole("status")).toContainText("0 eligible");
    await expect(page.getByRole("status")).toContainText("3 opted out/revoked");
  });
});
