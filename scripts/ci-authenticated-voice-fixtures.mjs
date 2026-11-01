import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const action = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !url.startsWith("http://127.0.0.1:")) throw new Error("Refusing non-loopback or incomplete CI Supabase configuration");
const { readFileSync, writeFileSync, unlinkSync, appendFileSync } = await import("node:fs");
const statePath = process.env.CI_E2E_FIXTURE_STATE;
const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const ids = { org: randomUUID(), agent: randomUUID(), contact: randomUUID(), campaign: randomUUID() };
const password = `VpCi!${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const email = `voicepilot-ci-${randomUUID()}@example.test`;
const otherEmail = `voicepilot-ci-other-${randomUUID()}@example.test`;
function saveState(state) { if (!statePath) throw new Error("CI_E2E_FIXTURE_STATE is required"); writeFileSync(statePath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 }); }
function loadState() { if (!statePath) throw new Error("CI_E2E_FIXTURE_STATE is required"); return JSON.parse(readFileSync(statePath, "utf8")); }
async function admin(path, options = {}) { const response = await fetch(`${url}${path}`, { ...options, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(options.headers || {}) } }); if (!response.ok) throw new Error(`Supabase admin request failed: ${response.status}`); return response.json(); }
async function setup() {
  const user = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  saveState({ userId: user.id });
  const other = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: otherEmail, password, email_confirm: true }) });
  saveState({ userId: user.id, otherUserId: other.id, orgId: ids.org, agentId: ids.agent, contactId: ids.contact, campaignId: ids.campaign });
  const insert = async (table, row) => { const { error } = await supabase.from(table).insert(row); if (error) throw new Error(`${table} fixture insert failed`); };
  await insert("profiles", { id: user.id, full_name: "CI Voice User" }); await insert("profiles", { id: other.id, full_name: "CI Other User" });
  await insert("organizations", { id: ids.org, name: "CI Disposable Voice Org", industry: "Testing", country: "XX", timezone: "UTC", created_by: user.id });
  await insert("organization_members", { organization_id: ids.org, user_id: user.id, role: "owner" });
  await insert("agents", { id: ids.agent, organization_id: ids.org, name: "CI Disposable Agent", instructions: "Synthetic acceptance agent", language: "en-US", status: "draft", created_by: user.id });
  await insert("contacts", { id: ids.contact, organization_id: ids.org, name: "CI Synthetic Contact", email: "ci-contact@example.test", phone: "+15550000001", consent_status: "granted" });
  await insert("campaigns", { id: ids.campaign, organization_id: ids.org, agent_id: ids.agent, name: "CI Disposable Campaign", status: "draft", timezone: "UTC", start_hour: 0, end_hour: 23, consent_required: true, created_by: user.id });
  const values = { CI_E2E_EMAIL: email, CI_E2E_PASSWORD: password, CI_E2E_USER_ID: user.id, CI_E2E_OTHER_USER_ID: other.id, CI_E2E_ORG_ID: ids.org, CI_E2E_AGENT_ID: ids.agent, CI_E2E_CONTACT_ID: ids.contact, CI_E2E_CAMPAIGN_ID: ids.campaign };
  const envFile = process.env.GITHUB_ENV; if (!envFile) throw new Error("GITHUB_ENV is required; refusing to emit fixture credentials");
  appendFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  console.log("Disposable synthetic fixtures created in the protected CI environment.");
}
async function cleanup() {
  let state;
  try { state = loadState(); } catch {
    const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error || users.data.users.some((user) => user.email?.startsWith("voicepilot-ci-"))) throw new Error("Fixture state is missing while synthetic users remain");
    const { data: orgs, error } = await supabase.from("organizations").select("id,name").ilike("name", "CI Disposable%");
    if (error || (orgs ?? []).length) throw new Error("Fixture state is missing while disposable organizations remain");
    console.log("No synthetic fixtures remain; cleanup is complete."); return;
  }
  const userId = state.userId; const otherId = state.otherUserId;
  for (const [table, column, value] of [["campaigns", "id", state.campaignId], ["contacts", "id", state.contactId], ["agents", "id", state.agentId], ["organization_members", "organization_id", state.orgId], ["organizations", "id", state.orgId], ["profiles", "id", userId], ["profiles", "id", otherId]]) if (value) await supabase.from(table).delete().eq(column, value);
  for (const id of [userId, otherId].filter(Boolean)) await admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  unlinkSync(statePath);
  console.log("Disposable synthetic fixtures cleaned up.");
}
if (action === "setup") await setup(); else if (action === "cleanup") await cleanup(); else throw new Error("Use setup or cleanup");
