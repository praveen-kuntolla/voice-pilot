import { expect, test, type Page } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

async function signIn(page: Page) {
  await waitForLoginHydration(page);
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.describe("authenticated campaign workspace", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");

  test("owner can create a draft without live controls and sees the saved/session boundary", async ({ page }) => {
    await signIn(page);
    let createdId: string | undefined;
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/dashboard/campaigns");
      await expect(page.getByRole("heading", { name: "Campaign workspace" })).toBeVisible();
      await expect(page.getByText("Saved configuration", { exact: true })).toBeVisible();
      await expect(page.getByText("No calls can be placed.", { exact: true })).toBeVisible();
      await page.getByLabel("Campaign name").fill("Browser draft campaign");
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Draft campaign saved" })).toBeVisible();
      await expect(page.getByText("Browser draft campaign")).toBeVisible();
      await expect(page.getByText("SAVED DRAFT", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /start live|place call|dispatch/i })).toHaveCount(0);
      const campaigns = await page.request.get("/api/campaigns");
      const body = await campaigns.json();
      createdId = body.campaigns?.find((campaign: { name: string; id: string }) => campaign.name === "Browser draft campaign")?.id;
    } finally {
      if (createdId) expect((await page.request.delete(`/api/campaigns/${createdId}`)).status()).toBe(200);
    }
  });

  test("rejects invalid calling hours before submission", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/campaigns");
    await page.getByLabel("Campaign name").fill("Invalid draft");
    await page.getByLabel("Start calling hour").fill("18");
    await page.getByLabel("End calling hour").fill("9");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("End calling hour must be after");
  });

  test("surfaces an agent API error while retaining stale campaign rows", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/campaigns");
    await expect(page.getByRole("heading", { name: "E2E Campaign A" })).toBeVisible();
    await page.route("**/api/agents", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Agent service unavailable for test" }) }));
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Agent service unavailable for test" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Campaign A" })).toBeVisible();
  });

  test("shows empty-agent guidance without claiming rehearsal readiness", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/campaigns", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ campaigns: [] }) }));
    await page.route("**/api/agents", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agents: [] }) }));
    await page.goto("/dashboard/campaigns");
    await expect(page.getByText(/No active agents are available/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an agent" })).toBeVisible();
  });

  test("rejects member writes and cross-tenant agent assignment server-side", async ({ page, baseURL }) => {
    await signIn(page);
    const switchResponse = await page.request.post("/api/organization/switch", { data: { organization_id: process.env.E2E_ORG_B }, headers: { origin: baseURL! } });
    expect(switchResponse.ok()).toBeTruthy();
    const forbidden = await page.request.post("/api/campaigns", { data: { name: "Unauthorized campaign", agent_id: process.env.E2E_AGENT_B, timezone: "UTC", start_hour: 9, end_hour: 17, consent_required: true } });
    expect(forbidden.status()).toBe(403);
    const crossTenant = await page.request.patch(`/api/campaigns/${process.env.E2E_CAMPAIGN_A}`, { data: { name: "Cross tenant mutation" } });
    expect([403, 404]).toContain(crossTenant.status());
  });
});
