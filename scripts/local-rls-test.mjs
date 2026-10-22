import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const metadataPath = `${process.env.TEMP}/voicepilot-local-fixtures.json`;
const fixture = JSON.parse(readFileSync(metadataPath, "utf8"));
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const status = JSON.parse(execFileSync(npxCommand, ["supabase", "status", "-o", "json"], { encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "true" } }));
const apiUrl = String(status.API_URL || "");
if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(apiUrl) || apiUrl.includes(".supabase.co")) throw new Error("Refusing non-local Supabase URL");
const anonKey = String(status.ANON_KEY || "");
const [userA, userB] = fixture.users;

const makeClient = () => createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function signedIn(user) {
  const client = makeClient();
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`fixture sign-in failed: ${error.message}`);
  return client;
}
async function rows(client, table, id) {
  const result = await client.from(table).select("id").eq("id", id);
  if (result.error) throw new Error(`${table} query failed: ${result.error.message}`);
  return result.data || [];
}
async function expectEmpty(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label} returned an unexpected database error: ${result.error.message}`);
  if ((result.data || []).length !== 0) throw new Error(`${label} was not isolated`);
}

const clientA = await signedIn(userA);
const clientB = await signedIn(userB);
const ownedAgents = await rows(clientA, "agents", userA.agent_id);
if (ownedAgents.length !== 1) throw new Error("owner cannot read its local agent");
const switchedAgents = await rows(clientA, "agents", userB.agent_id);
if (switchedAgents.length !== 1) throw new Error("valid second membership cannot read its selected organization agent");
await expectEmpty("cross-tenant agent read B->A", clientB.from("agents").select("id").eq("id", userA.agent_id));
await expectEmpty("cross-tenant contact read", clientB.from("contacts").select("id").eq("organization_id", userA.organization_id));
await expectEmpty("cross-tenant campaign read", clientB.from("campaigns").select("id").eq("organization_id", userA.organization_id));

const crossWrite = await clientA.from("agents").insert({ organization_id: userB.organization_id, name: "blocked", instructions: "blocked", created_by: userA.id });
if (!crossWrite.error) throw new Error("cross-tenant agent write was accepted");
const unauthenticated = makeClient();
await expectEmpty("unauthenticated agent read", unauthenticated.from("agents").select("id").eq("id", userA.agent_id));

console.log("RLS_OK organization membership and tenant isolation verified for agents, contacts and campaigns");
