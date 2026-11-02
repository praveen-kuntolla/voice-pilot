import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadSyntheticFixtureIdentity, startDisposableVoiceGateway } from "./lib/disposable-voice-gateway.mjs";

const repo = process.cwd();
const junction = resolve(repo, ".local", "supabase-loopback-source");
const source = "C:\\Users\\PC\\Documents\\ChatGPT\\voicepilot-ai\\.local\\supabase-loopback-source";
const fixturePath = resolve(repo, ".local", "voicepilot-local-loopback-fixtures.json");
let server;
let gateway;
let fixtureReady = false;
let junctionReady = false;
let resultCode = 1;
const productionServer = process.env.AUTHENTICATED_E2E_SERVER_MODE === "production";
const port = 3200 + Math.floor(Math.random() * 200);
const fixtureRoot = resolve(repo, ".local", `phase18e-${port}`);
const fixtureMetadata = resolve(fixtureRoot, "voicepilot-local-loopback-fixtures.json");
const fixtureSuffix = `phase18e${port}`;

const ps = (command) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: repo, encoding: "utf8", stdio: "inherit" });
const cleanupJunction = () => { if (junctionReady) { ps(`Remove-Item -LiteralPath '${junction}' -Recurse -Force -ErrorAction SilentlyContinue`); junctionReady = false; } };
const cleanupFixture = () => { if (fixtureReady) { const r = ps(`$env:VOICEPILOT_FIXTURE_ROOT='${fixtureRoot}'; $env:VOICEPILOT_FIXTURE_SUFFIX='${fixtureSuffix}'; & '${resolve(repo, "scripts/local-supabase-fixtures.ps1")}' -Action cleanup`); if (r.status !== 0) resultCode = 1; fixtureReady = false; } };
const stopServer = () => { if (server && !server.killed) { server.kill("SIGTERM"); server = undefined; } };
try {
  junctionReady = !existsSync(junction);
  ps(`$d='${source}'; New-Item -ItemType Directory -Path '${resolve(repo, ".local")}' -Force | Out-Null; if (-not (Test-Path -LiteralPath '${junction}')) { New-Item -ItemType Junction -Path '${junction}' -Target $d | Out-Null; }`);
  const setup = ps(`$env:VOICEPILOT_FIXTURE_ROOT='${fixtureRoot}'; $env:VOICEPILOT_FIXTURE_SUFFIX='${fixtureSuffix}'; & '${resolve(repo, "scripts/local-supabase-fixtures.ps1")}' -Action setup`);
  if (setup.status !== 0 || !existsSync(fixtureMetadata)) throw new Error("Synthetic fixture provisioning failed");
  fixtureReady = true;
  const fixture = JSON.parse(readFileSync(fixtureMetadata, "utf8").replace(/^\uFEFF/, ""));
  const identity = loadSyntheticFixtureIdentity(fixture);
  const authHealth = await fetch("http://127.0.0.1:55421/auth/v1/health").catch(() => null);
  if (!authHealth || authHealth.status >= 500) throw new Error(`Loopback Supabase Auth health check failed (${authHealth?.status ?? "unreachable"})`);
  if (!productionServer) gateway = await startDisposableVoiceGateway({ fixtureIdentity: identity });
  const env = { ...process.env, VOICEPILOT_FIXTURE_ROOT: fixtureRoot, PORT: String(port), PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${port}`, E2E_ISOLATED_AUTH: "true", NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || `.next-e2e-${port}`, PLAYWRIGHT_REUSE_EXISTING_SERVER: "true", VOICE_CONNECTIVITY_TEST_ENABLED: productionServer ? "false" : "true", VOICE_SESSION_POSTGRES_DISPOSABLE: productionServer ? "false" : "true", VOICE_OFFLINE_ADMISSION_TEST_ENABLED: "false", VOICE_OFFLINE_ADMISSION_SECRET: randomUUID(), VOICE_REALTIME_ENABLED: "false", VOICE_OUTBOUND_ENABLED: "false", VOICE_PROVIDER_ACTIVATION_ENABLED: "false", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55421", CI_E2E_EMAIL: fixture.users[0].email, CI_E2E_PASSWORD: fixture.users[0].password, CI_E2E_ORG_ID: identity.organizationId, CI_E2E_AGENT_ID: identity.agentId, E2E_EMAIL_A: fixture.users[0].email, E2E_PASSWORD_A: fixture.users[0].password, E2E_EMAIL_B: fixture.users[1].email, E2E_PASSWORD_B: fixture.users[1].password, E2E_EMAIL_C: fixture.users[2].email, E2E_PASSWORD_C: fixture.users[2].password, E2E_EMAIL_E: fixture.users[4]?.email, E2E_PASSWORD_E: fixture.users[4]?.password, E2E_ORG_A: fixture.ids.organizations[0], E2E_ORG_B: fixture.ids.organizations[1], E2E_CAMPAIGN_A: fixture.ids.campaigns[0], E2E_CAMPAIGN_B: fixture.ids.campaigns[1], E2E_CONTACT_A: fixture.ids.contacts[0], E2E_CONTACT_B: fixture.ids.contacts[1], E2E_AGENT_ID: fixture.ids.agents[0], E2E_AGENT_B: fixture.ids.agents[1], E2E_EMAIL_D: fixture.users[3]?.email, E2E_PASSWORD_D: fixture.users[3]?.password };
  if (gateway) Object.assign(env, { GATEWAY_DATABASE_URL: gateway.gatewayUrl, GATEWAY_ACTOR_ID: identity.actorId, GATEWAY_ORG_ID: identity.organizationId, GATEWAY_AGENT_ID: identity.agentId });
  server = spawn(process.execPath, [resolve(repo, "scripts/start-isolated-auth-dev.mjs"), productionServer ? "start" : "dev"], { cwd: repo, env, stdio: "inherit", windowsHide: true });
  let ready = false;
  for (let i = 0; i < 120; i++) { if (server.exitCode !== null) throw new Error("Isolated Next.js server exited before readiness"); try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { ready = true; break; } } catch {} await new Promise((r) => setTimeout(r, 500)); }
  if (!ready) throw new Error("Isolated Next.js server did not become ready");
  const spec = process.env.AUTHENTICATED_E2E_SPEC ?? "tests/e2e/phase-12b-authenticated-voice-session.spec.ts";
  const test = spawnSync(process.execPath, [resolve("node_modules/@playwright/test/cli.js"), "test", spec, "--workers=1"], { cwd: repo, env, stdio: "inherit" });
  resultCode = test.status ?? 1;
} catch (error) { console.error(`AUTHENTICATED_BROWSER_WINDOWS_FAILED: ${error.message}`); resultCode = 1; }
finally { stopServer(); if (gateway) { try { await gateway.cleanup(); } catch { resultCode = 1; } } cleanupFixture(); cleanupJunction(); }
process.exitCode = resultCode;
