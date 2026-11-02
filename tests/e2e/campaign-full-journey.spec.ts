import { expect, test } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test.describe("full contacts to offline rehearsal journey", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");
  test("imports, grants consent, selects one contact, rehearses, and invalidates stale readiness", async ({ page }) => {
    test.setTimeout(60000);
    await waitForLoginHydration(page);
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
    const authResponse = page.waitForResponse((response) => response.url().includes("/auth/v1/token"));
    await page.getByRole("button", { name: /log in/i }).click();
    await authResponse;
    await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });

    const suffix = Date.now();
    const importedName = `Journey CSV ${suffix}`;
    const importedEmail = `journey-${suffix}@example.test`;
    const importedPhone = `+1555${String(suffix).slice(-7)}`;
    let contactId: string | undefined;
    let campaignId: string | undefined;
    try {
      await page.goto("/dashboard/contacts");
      await page.getByLabel("Choose CSV file").setInputFiles({ name: "journey.csv", mimeType: "text/csv", buffer: Buffer.from(`name,email,phone\n${importedName},${importedEmail},${importedPhone}\n`) });
      await page.getByRole("button", { name: "Confirm import" }).click();
      await expect(page.getByRole("status")).toContainText(/Imported 1; already exists 0; invalid 0/);
      const imported = await page.evaluate(async (name) => { const response = await fetch("/api/contacts"); const body = await response.json(); return (body.contacts || []).find((contact: { name: string }) => contact.name === name); }, importedName);
      contactId = imported?.id;
      expect(imported?.consent_status).toBe("unknown");

      const consent = await page.request.patch(`/api/contacts/${contactId}`, { data: { consent_status: "granted" } });
      expect(consent.status()).toBe(200);

      await page.goto("/dashboard/campaigns");
      const campaignName = `Journey campaign ${suffix}`;
      await page.getByLabel("Campaign name").fill(campaignName);
      await page.getByLabel("Assigned agent").selectOption(process.env.E2E_AGENT_ID!);
      await page.getByLabel("Start calling hour").fill("9");
      await page.getByLabel("End calling hour").fill("17");
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText(campaignName)).toBeVisible();
      campaignId = await page.locator('article.card').filter({ hasText: campaignName }).getByRole("link", { name: "Review and rehearse" }).getAttribute("href").then((href) => href?.match(/campaign=([^&]+)/)?.[1]);
      expect(campaignId).toBeTruthy();

      await page.goto(`/dashboard/campaigns/review?campaign=${campaignId}`);
      await page.getByLabel("Simulation campaign").selectOption(campaignId!);
      await page.getByRole("button", { name: "Preview readiness" }).click();
      const readinessStatus = page.locator('[aria-label="Campaign readiness preview"] [role="status"]');
      await expect(readinessStatus).toContainText(/eligible/);
      await expect(page.getByText(/session-local and never saved/i)).toBeVisible();

      const checkboxes = page.locator('fieldset input[type="checkbox"]');
      const count = await checkboxes.count();
      for (let index = 0; index < count; index++) { if (await checkboxes.nth(index).isChecked()) await checkboxes.nth(index).uncheck(); }
      await page.locator('[aria-label="Campaign readiness preview"] fieldset label').filter({ hasText: importedName }).locator("input").check();
      await expect(readinessStatus).toContainText("1 selected");
      await page.getByRole("button", { name: "Run readiness check" }).click();
      await expect(page.getByText(/Ready\. This is simulation only/i)).toBeVisible();
      await page.getByRole("button", { name: "Start simulation" }).click();
      await expect(page.getByText("Simulated activity")).toBeVisible();
      await expect(page.getByText(importedName)).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop / reset" })).toBeEnabled();
      await page.getByRole("button", { name: "Stop / reset" }).click();
      await expect(page.getByText("Simulation reset.")).toBeVisible();

      await page.locator('[aria-label="Campaign readiness preview"] fieldset label').filter({ hasText: importedName }).locator("input").uncheck();
      await page.getByRole("button", { name: "Refresh authorization" }).click();
      await expect(readinessStatus).toContainText("0 selected");
      await expect(readinessStatus).toContainText(/No contacts are selected/);

      const revoke = await page.request.patch(`/api/contacts/${contactId}`, { data: { consent_status: "revoked" } });
      expect(revoke.status()).toBe(200);
      await page.locator('[aria-label="Campaign readiness preview"] fieldset label').filter({ hasText: importedName }).locator("input").check();
      await page.getByRole("button", { name: "Refresh authorization" }).click();
      await expect(readinessStatus).toContainText("0 eligible");
      await expect(readinessStatus).toContainText(/opted out\/revoked/);
      await expect(page.getByRole("button", { name: /start live|place call|dispatch/i })).toHaveCount(0);
    } finally {
      const removeOwnedRecord = async (url: string) => {
        const response = await page.request.delete(url, { timeout: 5000 });
        expect([200, 204, 404]).toContain(response.status());
      };
      await Promise.all([
        campaignId ? removeOwnedRecord(`/api/campaigns/${campaignId}`) : Promise.resolve(),
        contactId ? removeOwnedRecord(`/api/contacts/${contactId}`) : Promise.resolve(),
      ]);
    }
  });
});
