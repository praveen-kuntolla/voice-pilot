import { expect, test } from "@playwright/test";

const configured = () => process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

test("isolated local login rejects invalid credentials without creating a session", async ({ page, context }) => {
  test.skip(!configured(), "Isolated local auth fixtures are not configured");
  await login(page, process.env.E2E_EMAIL_A!, "definitely-not-the-fixture-password");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith("sb-") && cookie.value.length > 0)).toBeFalsy();
});

test("isolated local login persists a session, authorizes the dashboard, and logs out", async ({ page, context }) => {
  test.skip(!configured(), "Isolated local auth fixtures are not configured");
  await login(page, process.env.E2E_EMAIL_A!, process.env.E2E_PASSWORD_A!);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /workspace overview/i })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith("sb-") && cookie.value.length > 0)).toBeTruthy();

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /workspace overview/i })).toBeVisible();

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
