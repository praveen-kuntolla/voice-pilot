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

  test("revokes transcript after a denied second preflight and requires reauthorization", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/Turns completed: 1/)).toBeVisible();
    await page.getByRole("button", { name: "Preview TXT export" }).click();
    await expect(page.locator("pre")).toContainText("SIMULATION ONLY");

    const preflightRoute = "**/api/agents/*/simulation-preflight";
    await page.route(preflightRoute, async (route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Not authorized"}' });
    });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("No simulated events yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview TXT export" })).toHaveCount(0);
    await expect(page.locator("pre")).toHaveCount(0);
    await expect(page.getByText("Policy preflight")).toHaveCount(0);
    await expect(page.locator('p[role="alert"]')).toContainText("new server-approved preflight");

    await page.getByLabel("Sample customer message").fill("Retry without permission");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("No simulated events yet.")).toBeVisible();

    await page.unroute(preflightRoute);
    await page.getByLabel("Sample customer message").fill("New authorized synthetic session");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/Turns completed: 1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview TXT export" })).toBeVisible();
  });

  for (const mismatch of ["organization", "agent"] as const) {
    test(`revokes previous mock data when the preflight ${mismatch} changes`, async ({ page }) => {
      await login(page);
      await page.goto("/dashboard/agents/test");
      await page.getByLabel("Simulation agent").selectOption({ index: 1 });
      await page.getByRole("button", { name: "Run simulation" }).click();
      await expect(page.getByText(/Turns completed: 1/)).toBeVisible();

      await page.route("**/api/agents/*/simulation-preflight", async (route) => {
        const badResult = mismatch === "organization"
          ? { allowed: true, agentId: new URL(route.request().url()).pathname.split("/")[3], organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
          : { allowed: true, agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", organizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(badResult) });
      });
      await page.getByRole("button", { name: "Run simulation" }).click();
      await expect(page.getByText("No simulated events yet.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Preview JSON export" })).toHaveCount(0);
      await expect(page.locator('p[role="alert"]')).toContainText("new server-approved preflight");
    });
  }

  test("disables a ninth turn without another server preflight", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    let preflightRequests = 0;
    page.on("request", (request) => {
      if (/\/api\/agents\/[^/]+\/simulation-preflight/.test(new URL(request.url()).pathname)) preflightRequests++;
    });
    for (let index = 0; index < 8; index++) {
      await page.getByRole("button", { name: "Run simulation" }).click();
      await expect(page.getByText(new RegExp(`Turns completed: ${index + 1} / 8`))).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Run simulation" })).toBeDisabled();
    await expect(page.getByText("Reset to start another simulated session.")).toBeVisible();
    expect(preflightRequests).toBe(8);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByRole("button", { name: "Run simulation" })).toBeEnabled();
    await expect(page.getByText("No simulated events yet.")).toBeVisible();
  });

  test("reset while preflight is pending suppresses a late denied response", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    let release!: () => void;
    let intercepted!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { intercepted = resolve; });
    await page.route("**/api/agents/*/simulation-preflight", async (route) => {
      intercepted();
      await pending;
      try { await route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Denied"}' }); } catch { /* Reset aborts the request. */ }
    });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await reached;
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    release();
    await expect(page.getByText("No simulated events yet.")).toBeVisible();
    await expect(page.getByText(/State: idle/)).toBeVisible();
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Preview TXT export" })).toHaveCount(0);
  });


  test("unmount during a pending denied preflight cannot restore an old transcript", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/agents/test");
    await page.getByLabel("Simulation agent").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/Turns completed: 1/)).toBeVisible();

    let release!: () => void;
    let intercepted!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { intercepted = resolve; });
    await page.route("**/api/agents/*/simulation-preflight", async (route) => {
      intercepted();
      await hold;
      try { await route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Denied"}' }); } catch { /* Navigation aborts the old request. */ }
    });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await reached;
    await page.goto("/dashboard");
    release();
    await page.goto("/dashboard/agents/test");
    await expect(page.getByText("No simulated events yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview TXT export" })).toHaveCount(0);
    await expect(page.locator("pre")).toHaveCount(0);
  });

});
