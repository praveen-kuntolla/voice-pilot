import { expect, test } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test.describe("authenticated contacts CSV import", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");
  test("imports valid rows with unknown consent and rejects duplicates/invalid rows", async ({ page }) => {
    await waitForLoginHydration(page);
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto("/dashboard/contacts");

    const suffix = Date.now();
    const importedName = `Synthetic CSV ${suffix}`;
    const importedEmail = `csv-${suffix}@example.test`;
    const importedPhone = `+1555${String(suffix).slice(-7)}`;
    await page.getByLabel("Choose CSV file").setInputFiles({
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`name,email,phone,consent_status\n${importedName},${importedEmail},${importedPhone},granted\nDuplicate,${importedEmail},+15551234567,granted\nMissing phone,,12,granted\n`),
    });
    await expect(page.getByText("Valid new")).toBeVisible();
    await expect(page.getByText("duplicate email in file")).toBeVisible();
    await expect(page.getByText("invalid phone")).toBeVisible();
    await page.getByRole("button", { name: "Confirm import" }).click();
    await expect(page.getByRole("status")).toContainText(/Imported 1; already exists 1; invalid 1; failed 0; needs verification 0/);
    const created = await page.evaluate(async (name) => {
      const response = await fetch("/api/contacts");
      const data = await response.json();
      return (data.contacts || []).find((contact: { name: string }) => contact.name === name) as { id: string; consent_status: string } | undefined;
    }, importedName);
    expect(created?.consent_status).toBe("unknown");
    if (created) await page.evaluate(async (id) => { await fetch(`/api/contacts/${id}`, { method: "DELETE" }); }, created.id);
  });
});
