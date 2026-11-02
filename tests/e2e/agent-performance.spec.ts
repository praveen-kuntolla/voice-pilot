import { expect, test, type Page } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

async function signIn(page: Page, email = process.env.E2E_EMAIL_A!, password = process.env.E2E_PASSWORD_A!) {
  await waitForLoginHydration(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.describe("agent performance dashboard", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");

  test("shows an empty state, current synthetic scorecards, and clears on session reset", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/agents/performance");
    const workspace = page.getByLabel("Agent performance workspace");
    await expect(workspace).toContainText("SIMULATION ONLY");
    await expect(workspace.getByLabel("No synthetic evaluation")).toBeVisible();
    await expect(workspace.getByRole("combobox", { name: "Performance agent" })).toBeVisible();

    await page.goto(`/dashboard/agents/test?agent=${process.env.E2E_AGENT_ID}`);
    await page.getByRole("combobox", { name: "Simulation agent" }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByRole("region", { name: "Offline evaluation" })).toContainText("1");
    await page.goto("/dashboard/agents/performance");
    await expect(page.getByLabel("Synthetic evaluation scorecards")).toContainText("100/100");
    await expect(page.getByLabel("Synthetic success and failure breakdown")).toContainText("Completed");
    await expect(page.getByLabel("Synthetic conversation history")).toContainText("completed");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Synthetic evaluation scorecards")).toBeVisible();
    await page.goto(`/dashboard/agents/test?agent=${process.env.E2E_AGENT_ID}`);
    await page.getByRole("button", { name: "Reset evaluation" }).click();
    await page.goto("/dashboard/agents/performance");
    await expect(page.getByLabel("No synthetic evaluation")).toBeVisible();
  });

  test("only exposes the signed-in organization agent", async ({ page }) => {
    await signIn(page, process.env.E2E_EMAIL_B!, process.env.E2E_PASSWORD_B!);
    await page.goto("/dashboard/agents/performance");
    const options = await page.getByRole("combobox", { name: "Performance agent" }).locator("option").allTextContents();
    expect(options).toContain("E2E Agent B");
    expect(options.join(" ")).not.toContain("E2E Agent A");
  });

  test("aggregates multiple completed synthetic turns and supports selection reset", async ({ page }) => {
    await signIn(page);
    await page.goto(`/dashboard/agents/test?agent=${process.env.E2E_AGENT_ID}`);
    const simulationAgent = page.getByRole("combobox", { name: "Simulation agent" });
    await simulationAgent.selectOption({ index: 1 });
    const run = page.getByRole("button", { name: "Run simulation" });
    await run.click();
    await expect(page.getByText(/State: idle/)).toBeVisible();
    await run.click();
    await expect(page.getByText(/Turns completed: 2/)).toBeVisible();
    await page.goto("/dashboard/agents/performance");
    const workspace = page.getByLabel("Agent performance workspace");
    await expect(workspace.getByLabel("Synthetic conversation history")).toContainText("Turn 2");
    await expect(workspace.getByLabel("Synthetic success and failure breakdown")).toContainText("2");
    await workspace.getByRole("combobox", { name: "Performance agent" }).selectOption("");
    await expect(workspace.getByLabel("No synthetic evaluation")).toBeVisible();
  });

  test("records failed and interrupted synthetic turns with lifecycle warnings", async ({ page }) => {
    await signIn(page);
    await page.goto(`/dashboard/agents/test?agent=${process.env.E2E_AGENT_ID}`);
    await page.getByRole("combobox", { name: "Simulation agent" }).selectOption({ index: 1 });
    await page.getByRole("combobox", { name: "Simulation outcome" }).selectOption("error");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/State: failed/)).toBeVisible();
    await page.goto("/dashboard/agents/performance");
    await expect(page.getByLabel("Synthetic success and failure breakdown")).toContainText("Failed");
    await expect(page.getByLabel("Evaluation warnings")).toContainText("Lifecycle");

    await page.goto(`/dashboard/agents/test?agent=${process.env.E2E_AGENT_ID}`);
    await page.getByRole("combobox", { name: "Simulation agent" }).selectOption({ index: 1 });
    await page.getByRole("combobox", { name: "Simulation outcome" }).selectOption("slow");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByRole("button", { name: "Interrupt" })).toBeEnabled();
    await page.getByRole("button", { name: "Interrupt" }).click();
    await page.goto("/dashboard/agents/performance");
    await expect(page.getByLabel("Synthetic conversation history")).toContainText("interrupted");
  });

  test("rejects malformed and cross-tenant session snapshots and remains keyboard accessible", async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto("/dashboard/agents/performance");
    const workspace = page.getByLabel("Agent performance workspace");
    const select = workspace.getByRole("combobox", { name: "Performance agent" });
    await select.focus();
    await expect(select).toBeFocused();
    const organizationId = process.env.E2E_ORG_A!;
    const agentId = process.env.E2E_AGENT_ID!;
    await page.evaluate(({ organizationId, agentId, otherOrganizationId }) => {
      const key = `voicepilot:offline-agent-performance:v1:${organizationId}:${agentId}`;
      sessionStorage.setItem(key, JSON.stringify({ version: 1, organizationId: otherOrganizationId, agentId, hasInstructions: true, language: "en-US", voiceId: "safe-demo", state: "idle", turns: 1, preflightAllowed: true, outcomes: [], updatedAt: new Date().toISOString() }));
    }, { organizationId, agentId, otherOrganizationId: process.env.E2E_ORG_B! });
    await page.reload();
    await expect(workspace.getByLabel("No synthetic evaluation")).toBeVisible();
    await page.evaluate(({ organizationId, agentId }) => sessionStorage.setItem(`voicepilot:offline-agent-performance:v1:${organizationId}:${agentId}`, "not-json"), { organizationId, agentId });
    await page.reload();
    await expect(workspace.getByLabel("No synthetic evaluation")).toBeVisible();
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expect(workspace.getByRole("combobox", { name: "Performance agent" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`agent-performance-${viewport.width}.png`), fullPage: true });
    }
  });
});
