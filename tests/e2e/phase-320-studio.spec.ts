import { expect, test } from "@playwright/test";

const isolated = process.env.E2E_ISOLATED_AUTH === "true";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("Phase 3.20 testing studio", () => {
  test.skip(!isolated, "Requires explicitly configured isolated Supabase auth fixtures.");

  test("supports agent selection, policy preflight and simulation reset", async ({ page }) => {
    await page.goto("/dashboard/agents/test");
    await login(page);
    await page.goto("/dashboard/agents/test");
    await expect(page.getByText("AI Agent Testing Studio")).toBeVisible();
    await page.getByLabel("Search agents").fill("E2E");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("Policy preflight")).toBeVisible();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("No simulated events yet.")).toBeVisible();
  });

  test("previews a simulation-only transcript without uploading it", async ({ page }) => {
    await page.goto("/dashboard/agents/test");
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await page.getByRole("button", { name: "Preview TXT export" }).click();
    await expect(page.locator("pre")).toContainText("SIMULATION ONLY");
    await expect(page.getByText("Review for personal information before downloading.")).toBeVisible();
  });
});
