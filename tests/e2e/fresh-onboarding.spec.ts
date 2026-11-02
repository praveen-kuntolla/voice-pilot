import { expect, test } from "@playwright/test";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_D && process.env.E2E_PASSWORD_D);

test.describe("fresh-user onboarding", () => {
  test.skip(!isolated, "Requires the isolated no-membership fixture.");
  test("persists profile and creates the first organization", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_D!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_D!);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    const organization = `Fresh workspace ${Date.now()}`;
    await page.getByLabel("Full name").fill("Fresh Onboarding User");
    await page.getByLabel("Organization name").fill(organization);
    await page.getByLabel("Industry").fill("Testing");
    await page.getByLabel("Business use case").fill("Validate local onboarding persistence safely");
    await page.getByLabel("Country").fill("IN");
    await page.getByLabel("Timezone").fill("Asia/Calcutta");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Fresh Onboarding User")).toBeVisible();
    const profile = await page.request.get("/api/profile");
    expect(profile.ok()).toBeTruthy();
    expect((await profile.json()).profile.full_name).toBe("Fresh Onboarding User");
    await page.reload();
    await expect(page.getByText(organization, { exact: true })).toBeVisible();
    await expect(page.getByText("Fresh Onboarding User")).toBeVisible();
  });
});
