import { expect, test } from "@playwright/test";

const isolated = process.env.E2E_ISOLATED_AUTH === "true";

test.describe("Phase 3.20 testing studio", () => {
  test.skip(!isolated, "Requires explicitly configured isolated Supabase auth fixtures.");

  test("supports agent selection, policy preflight and simulation reset", async ({ page }) => {
    await page.goto("/dashboard/agents/test");
    await expect(page.getByText("AI Agent Testing Studio")).toBeVisible();
    await page.getByLabel("Search agents").fill("Test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("Policy preflight")).toBeVisible();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("No simulated events yet.")).toBeVisible();
  });

  test("previews a simulation-only transcript without uploading it", async ({ page }) => {
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await page.getByRole("button", { name: "Preview TXT export" }).click();
    await expect(page.getByText("SIMULATION ONLY", { exact: false })).toBeVisible();
    await expect(page.getByText("Review for personal information before downloading.")).toBeVisible();
  });
});
