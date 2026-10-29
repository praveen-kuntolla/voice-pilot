import { expect, test } from "@playwright/test";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_C && process.env.E2E_PASSWORD_C);

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_C!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_C!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("Phase 6 multi-turn Agent Test Studio", () => {
  test.skip(!isolated, "Requires explicitly configured isolated Supabase auth fixtures.");

  test("runs ordered synthetic turns and resets the local session", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (/livekit|deepgram|elevenlabs|openai\.com|twilio|telnyx/i.test(request.url())) externalRequests.push(request.url()); });
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Search agents").fill("E2E");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/Turns completed: 1/)).toBeVisible();
    await page.getByLabel("Sample customer message").fill("What is the next synthetic step?");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/Turns completed: 2/)).toBeVisible();
    await expect(page.getByText(/Turn 2 · \[idle\/diagnostic\] Turn complete/)).toBeVisible();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByText("No simulated events yet.")).toBeVisible();
    expect(externalRequests).toEqual([]);
  });

  test("handles deterministic failure and interruption controls", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByLabel("Simulation outcome").selectOption("error");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("Mock provider failure", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.getByLabel("Simulation outcome").selectOption("slow");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await page.getByRole("button", { name: "Interrupt" }).click();
    await expect(page.getByText(/State: idle/)).toBeVisible();
    await expect(page.getByText(/interrupted/i)).toBeVisible();
  });

  test("supports a synthetic preset and local export preview", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByLabel("Synthetic scenario preset").selectOption("new-inquiry");
    await page.getByRole("button", { name: "Load preset" }).click();
    await page.getByRole("button", { name: "Run simulation" }).click();
    await page.getByRole("button", { name: "Preview JSON export" }).click();
    await expect(page.locator("pre")).toContainText('"simulationOnly": true');
    await expect(page.locator("pre")).toContainText("NO LIVE PROVIDERS");
  });
});
