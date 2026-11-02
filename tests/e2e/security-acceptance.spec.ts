import { expect, test, type Page } from "@playwright/test";

const isolated = process.env.E2E_ISOLATED_AUTH === "true";

async function signIn(page: Page, email: string | undefined, password: string | undefined) {
  expect(email).toBeTruthy();
  expect(password).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("consolidated local security acceptance", () => {
  test.beforeEach(() => test.skip(!isolated, "Requires disposable authenticated fixtures."));

  test("owner and admin can read their tenant while provider controls remain disabled", async ({ page }) => {
    await signIn(page, process.env.E2E_EMAIL_A, process.env.E2E_PASSWORD_A);
    const campaigns = await page.request.get("/api/campaigns");
    expect(campaigns.ok()).toBeTruthy();
    expect((await campaigns.json()).campaigns.every((item: { organization_id: string }) => item.organization_id === process.env.E2E_ORG_A)).toBe(true);
    await page.goto("/dashboard/recovery");
    await expect(page.getByText(/SIMULATION ONLY.*no reconciliation or release action/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /release|reconcile|retry/i })).toHaveCount(0);
  });

  test("member access cannot mutate or cross tenant-read campaign/contact data", async ({ page, baseURL }) => {
    await signIn(page, process.env.E2E_EMAIL_A, process.env.E2E_PASSWORD_A);
    const switched = await page.request.post("/api/organization/switch", { headers: { origin: baseURL! }, data: { organization_id: process.env.E2E_ORG_B } });
    expect(switched.status()).toBe(200);
    const campaignWrite = await page.request.patch(`/api/campaigns/${process.env.E2E_CAMPAIGN_B}`, { data: { name: "unauthorized" } });
    expect(campaignWrite.status()).toBe(403);
    const contactWrite = await page.request.patch(`/api/contacts/${process.env.E2E_CONTACT_B}`, { data: { name: "unauthorized" } });
    expect(contactWrite.status()).toBe(403);
    const agents = await page.request.get("/api/agents");
    expect((await agents.json()).agents.every((item: { organization_id: string }) => item.organization_id === process.env.E2E_ORG_B)).toBe(true);
  });

  test("admin cannot use stale or revoked consent to authorize rehearsal", async ({ page }) => {
    await signIn(page, process.env.E2E_EMAIL_C, process.env.E2E_PASSWORD_C);
    const revoked = await page.request.patch(`/api/contacts/${process.env.E2E_CONTACT_A}`, { data: { consent_status: "revoked" } });
    expect(revoked.status()).toBe(200);
    const preflight = await page.request.get(`/api/campaigns/${process.env.E2E_CAMPAIGN_A}/simulation-preflight`);
    expect(preflight.status()).toBe(200);
    const body = await preflight.json();
    const contact = body.contacts.find((item: { id: string }) => item.id === process.env.E2E_CONTACT_A);
    expect(contact.eligible).toBe(false);
  });

  test("authenticated workspace exposes no real execution controls", async ({ page }) => {
    await signIn(page, process.env.E2E_EMAIL_A, process.env.E2E_PASSWORD_A);
    await page.goto("/dashboard/campaigns");
    await expect(page.getByText(/simulation only|no outbound calls/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /start campaign|call now|dispatch|dial/i })).toHaveCount(0);
  });

  test("viewer can read tenant data but cannot mutate or switch without membership", async ({ page, baseURL }) => {
    await signIn(page, process.env.E2E_EMAIL_E, process.env.E2E_PASSWORD_E);
    for (const path of ["/api/agents", "/api/campaigns", "/api/contacts", "/api/knowledge"]) expect((await page.request.get(path)).status()).toBe(200);
    expect((await page.request.post("/api/agents", { data: { name: "viewer", instructions: "blocked", language: "en-US", status: "draft" } })).status()).toBe(403);
    expect((await page.request.post("/api/campaigns", { data: { name: "viewer", agent_id: process.env.E2E_AGENT_ID, timezone: "UTC", start_hour: 9, end_hour: 17, consent_required: true } })).status()).toBe(403);
    expect((await page.request.post("/api/contacts", { data: { name: "viewer", phone: "+15550000044", consent_status: "granted" } })).status()).toBe(403);
    expect((await page.request.post("/api/knowledge", { data: { title: "viewer", source_type: "text", source_uri: "blocked" } })).status()).toBe(403);
    expect((await page.request.post("/api/organization/switch", { headers: { origin: baseURL! }, data: { organization_id: process.env.E2E_ORG_B } })).status()).toBe(403);
  });

  test("disabled LiveKit routes fail closed for anonymous and authenticated requests", async ({ page }) => {
    const anonymousToken = await page.request.post("/api/livekit/token", { data: { agent_id: process.env.E2E_AGENT_ID } });
    const anonymousSession = await page.request.post("/api/livekit/browser-session", { data: { agent_id: process.env.E2E_AGENT_ID, microphone_consent: true } });
    expect(anonymousToken.status()).toBe(401);
    expect(anonymousSession.status()).toBe(401);
    await signIn(page, process.env.E2E_EMAIL_A, process.env.E2E_PASSWORD_A);
    const token = await page.request.post("/api/livekit/token", { data: { agent_id: process.env.E2E_AGENT_ID } });
    const session = await page.request.post("/api/livekit/browser-session", { data: { agent_id: process.env.E2E_AGENT_ID, microphone_consent: true } });
    expect(token.status()).toBe(503);
    expect(session.status()).toBe(503);
    expect(await token.json()).not.toHaveProperty("token");
    expect(await session.json()).not.toHaveProperty("token");
  });
});
