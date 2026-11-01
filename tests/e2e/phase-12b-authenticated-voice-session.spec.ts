import { test, expect } from "@playwright/test";
import { Client } from "pg";

test("runs the real authenticated admission, reservation, cancellation and release path", async ({ page }) => {
  for (const key of ["CI_E2E_EMAIL", "CI_E2E_PASSWORD", "CI_E2E_AGENT_ID", "CI_E2E_ORG_ID"]) expect(process.env[key], `${key} must be provided; acceptance cannot skip`).toBeTruthy();
  await page.goto("/login"); await page.getByLabel("Email").fill(process.env.CI_E2E_EMAIL!); await page.getByLabel("Password").fill(process.env.CI_E2E_PASSWORD!); await page.getByRole("button", { name: /log in/i }).click(); await expect(page).toHaveURL(/dashboard/);
  const denied = await page.request.post("/api/voice-session/offline", { data: { agent_id: process.env.CI_E2E_AGENT_ID, microphone_consent: false } }); expect(denied.status()).toBe(400);
  const started = await page.request.post("/api/voice-session/offline", { data: { agent_id: process.env.CI_E2E_AGENT_ID, microphone_consent: true } }); const startedText = await started.text(); expect(started.status(), `admission response: ${startedText.slice(0, 200)}`).toBe(201); const body = JSON.parse(startedText);
  expect(body.session?.organizationId).toBe(process.env.CI_E2E_ORG_ID); expect(body.session?.providerActivationEnabled).toBe(false); expect(body.session?.noRecording).toBe(true);
  const payload = { agent_id: process.env.CI_E2E_AGENT_ID, session_id: body.session.sessionId, assertion_id: body.session.assertionId }; const cancelled = await page.request.delete("/api/voice-session/offline", { data: payload }); expect(cancelled.ok()).toBeTruthy(); const repeated = await page.request.delete("/api/voice-session/offline", { data: payload }); expect(repeated.ok()).toBeTruthy();
  const db = new Client({ connectionString: process.env.GATEWAY_DATABASE_URL }); await db.connect(); const state = await db.query("select consumed_at is not null as consumed, released_at is not null as released from public.voice_session_authorizations where session_id=$1", [body.session.sessionId]); expect(state.rows).toHaveLength(1); expect(state.rows[0]).toMatchObject({ consumed: true, released: true }); await db.end();
});
