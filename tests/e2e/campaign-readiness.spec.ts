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
    await page.goto("/dashboard/campaigns");
    await expect(page.getByText("SIMULATION ONLY").first()).toBeVisible();
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
    await expect(page.getByText(/no calls or messages are created/i)).toBeVisible();
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
});
