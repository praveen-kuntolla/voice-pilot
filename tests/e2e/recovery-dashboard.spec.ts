import { expect, test, type Page } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test("unauthenticated users are redirected from recovery", async ({ page }) => {
  await page.goto("/dashboard/recovery");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page).not.toHaveURL(/\/dashboard\/recovery/);
});

async function signIn(page: Page) {
  await waitForLoginHydration(page);
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.describe("offline recovery dashboard", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");

  test("renders synthetic recovery states without release controls", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/recovery");
    await expect(page.getByRole("heading", { name: "Offline recovery status" })).toBeVisible();
    for (const label of ["Termination requested", "Cleanup failed", "Termination unconfirmed", "Awaiting reconciliation", "Cleanup confirmed", "Released"]) {
      await expect(page.getByRole("heading", { name: label })).toBeVisible();
    }
    await expect(page.getByText(/SIMULATION ONLY — no reconciliation or release action is available here/)).toBeVisible();
    await expect(page.getByText(/Capacity release is blocked until authoritative termination evidence exists/)).toHaveCount(2);
    await expect(page.getByRole("button", { name: /release|retry|reconcile/i })).toHaveCount(0);
    await page.getByRole("link", { name: /Back to Agent Test Studio/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/agents\/test$/);
  });

  test("keeps essential recovery content usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto("/dashboard/recovery");
    await expect(page.getByRole("heading", { name: "Offline recovery status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Termination unconfirmed" })).toBeVisible();
    await expect(page.getByText(/capacity cannot be released/i)).toBeVisible();
  });
});
