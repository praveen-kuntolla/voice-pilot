import { expect, test } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" &&
  Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test("settings, Calls and Analytics redirect guests to login", async ({ page }) => {
  for (const path of ["/settings", "/dashboard/calls", "/dashboard/analytics"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("authenticated dashboard links open implemented settings and simulation screens", async ({ page }) => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");
  await waitForLoginHydration(page);
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /workspace overview/i })).toBeVisible();

  const sidebar = page.locator("aside.side");
  const routes = {
    Overview: "/dashboard",
    Agents: "/dashboard/agents",
    Contacts: "/dashboard/contacts",
    Campaigns: "/dashboard/campaigns",
    Calls: "/dashboard/calls",
    Analytics: "/dashboard/analytics",
    Settings: "/settings",
  } as const;

  for (const [name, href] of Object.entries(routes)) {
    await expect(sidebar.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await expect(sidebar.locator('a[href="/dashboard/settings"]')).toHaveCount(0);

  await sidebar.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Organization settings" })).toBeVisible();
  await page.getByRole("button", { name: "Provider governance" }).click();
  await expect(page.getByRole("heading", { name: "Organization provider approvals" })).toBeVisible();

  await page.getByRole("link", { name: /back to dashboard/i }).click();
  await expect(page.getByRole("heading", { name: /workspace overview/i })).toBeVisible();
  await page.locator("aside.side").getByRole("link", { name: "Calls", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/calls/);
  await expect(page.getByRole("heading", { name: "Simulated calls" })).toBeVisible();
  await expect(page.getByText("SIMULATION ONLY.", { exact: false }).first()).toBeVisible();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/analytics/);
  await expect(page.getByRole("heading", { name: "Simulation analytics" })).toBeVisible();
  await page.getByRole("link", { name: /open simulation studio/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/campaigns#simulation-studio/);
  await expect(page.getByText("Simulation Studio", { exact: false }).first()).toBeVisible();
});
