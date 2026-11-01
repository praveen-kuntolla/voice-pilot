import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const action = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !url.startsWith("http://127.0.0.1:")) throw new Error("Refusing non-loopback or incomplete CI Supabase configuration");
const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const ids = { org: randomUUID(), agent: randomUUID(), contact: randomUUID(), campaign: randomUUID() };
const password = `VpCi!${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const email = `voicepilot-ci-${randomUUID()}@example.test`;
const otherEmail = `voicepilot-ci-other-${randomUUID()}@example.test`;
async function admin(path, options = {}) { const response = await fetch(`${url}${path}`, { ...options, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(options.headers || {}) } }); if (!response.ok) throw new Error(`Supabase admin request failed: ${response.status}`); return response.json(); }
async function setup() {
  const user = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  const other = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: otherEmail, password, email_confirm: true }) });
  const insert = async (table, row) => { const { error } = await supabase.from(table).insert(row); if (error) throw new Error(`${table} fixture insert failed`); };
  await insert("profiles", { id: user.id, full_name: "CI Voice User" }); await insert("profiles", { id: other.id, full_name: "CI Other User" });
  await insert("organizations", { id: ids.org, name: "CI Disposable Voice Org", industry: "Testing", country: "XX", timezone: "UTC", created_by: user.id });
  await insert("organization_members", { organization_id: ids.org, user_id: user.id, role: "owner" });
  await insert("agents", { id: ids.agent, organization_id: ids.org, name: "CI Disposable Agent", instructions: "Synthetic acceptance agent", language: "en-US", status: "draft", created_by: user.id });
  await insert("contacts", { id: ids.contact, organization_id: ids.org, name: "CI Synthetic Contact", email: "ci-contact@example.test", phone: "+15550000001", consent_status: "granted" });
  await insert("campaigns", { id: ids.campaign, organization_id: ids.org, agent_id: ids.agent, name: "CI Disposable Campaign", status: "draft", timezone: "UTC", start_hour: 0, end_hour: 23, consent_required: true, created_by: user.id });
  const values = { CI_E2E_EMAIL: email, CI_E2E_PASSWORD: password, CI_E2E_USER_ID: user.id, CI_E2E_OTHER_USER_ID: other.id, CI_E2E_ORG_ID: ids.org, CI_E2E_AGENT_ID: ids.agent, CI_E2E_CONTACT_ID: ids.contact, CI_E2E_CAMPAIGN_ID: ids.campaign };
  const envFile = process.env.GITHUB_ENV; if (!envFile) throw new Error("GITHUB_ENV is required; refusing to emit fixture credentials");
  const { appendFileSync } = await import("node:fs"); appendFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  console.log("Disposable synthetic fixtures created in the protected CI environment.");
}
async function cleanup() {
  const userId = process.env.CI_E2E_USER_ID; const otherId = process.env.CI_E2E_OTHER_USER_ID;
  for (const [table, column, value] of [["campaigns", "id", process.env.CI_E2E_CAMPAIGN_ID], ["contacts", "id", process.env.CI_E2E_CONTACT_ID], ["agents", "id", process.env.CI_E2E_AGENT_ID], ["organization_members", "organization_id", process.env.CI_E2E_ORG_ID], ["organizations", "id", process.env.CI_E2E_ORG_ID], ["profiles", "id", userId], ["profiles", "id", otherId]]) if (value) await supabase.from(table).delete().eq(column, value);
  for (const id of [userId, otherId].filter(Boolean)) await admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  console.log("Disposable synthetic fixtures cleaned up.");
}
if (action === "setup") await setup(); else if (action === "cleanup") await cleanup(); else throw new Error("Use setup or cleanup");
