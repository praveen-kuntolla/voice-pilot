import { expect, test } from "@playwright/test";
const enabled = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_C && process.env.E2E_PASSWORD_C);
test("isolated campaign simulation remains visibly mock-only", async ({ page }) => {
  test.skip(!enabled, "Requires disposable isolated campaign fixtures.");
  await page.goto("/login"); await page.getByLabel("Email").fill(process.env.E2E_EMAIL_C!); await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_C!); await page.getByRole("button", { name: /log in/i }).click(); await expect(page).toHaveURL(/dashboard/);
  await page.goto("/dashboard/campaigns"); await expect(page.getByText("Simulation Studio", { exact: false })).toBeVisible(); await expect(page.getByText(/no outbound calls/i)).toBeVisible();
});
