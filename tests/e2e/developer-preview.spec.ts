import { expect, test } from "@playwright/test";

// Explicit opt-in. This screen is available only under Next.js development
// mode and a loopback Host header; production-build E2E must not expose it.
test.skip(process.env.DEVELOPER_PREVIEW_E2E !== "1", "Run only against an explicitly verified local development server.");

test("developer preview navigation and synthetic operations", async ({ page }) => {
  await page.goto("/developer-preview");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("SIMULATION ONLY", { exact: false }).first()).toBeVisible();

  await page.getByRole("navigation", { name: "Developer preview navigation" }).getByRole("button", { name: "Agents" }).click();
  await page.getByPlaceholder("Agent name").fill("Demo Tester");
  await page.getByRole("button", { name: "Add agent" }).click();
  await expect(page.getByText("Demo Tester")).toBeVisible();
  await page.getByRole("button", { name: "Activate demo" }).first().click();

  await page.getByRole("navigation", { name: "Developer preview navigation" }).getByRole("button", { name: "Contacts" }).click();
  await page.getByPlaceholder("Contact name").fill("Synthetic Reviewer");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Synthetic Reviewer")).toBeVisible();
  await page.getByRole("textbox", { name: "Search contacts" }).fill("Synthetic Reviewer");
  await expect(page.getByText("Asha Demo")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search contacts" }).fill("");

  await page.getByRole("navigation", { name: "Developer preview navigation" }).getByRole("button", { name: "Campaigns" }).click();
  await page.getByPlaceholder("Campaign name").fill("Visual Test Campaign");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Visual Test Campaign")).toBeVisible();
  await page.getByRole("button", { name: "Start demo" }).first().click();
  await expect(page.getByRole("status")).toContainText("No real calls");

  await page.getByRole("navigation", { name: "Developer preview navigation" }).getByRole("button", { name: "Calls" }).click();
  await page.getByRole("button", { name: "Simulate one call" }).click();
  await expect(page.getByRole("status")).toContainText("Simulated outcome");

  await page.getByRole("navigation", { name: "Developer preview navigation" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Enable demo emergency stop" }).click();
  await page.getByRole("navigation", { name: "Developer preview navigation" }).getByRole("button", { name: "Calls" }).click();
  await page.getByRole("button", { name: "Simulate one call" }).click();
  await expect(page.getByRole("status")).toContainText("blocked");

  await page.getByRole("navigation", { name: "Developer preview navigation" }).getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByText("Completed synthetic simulations")).toBeVisible();
  await expect(page.getByTestId("developer-operation-log")).toContainText("blocked_by_stop");
});

test("developer preview remains isolated from real authentication", async ({ page }) => {
  await page.goto("/developer-preview");
  const login = page.getByRole("link", { name: "Open real login (separate)" });
  await expect(login).toHaveAttribute("href", "/login");
  await login.click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Log in to your workspace.")).toBeVisible();
});
