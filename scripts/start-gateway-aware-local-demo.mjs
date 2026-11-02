import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadSyntheticFixtureIdentity, startDisposableVoiceGateway } from "./lib/disposable-voice-gateway.mjs";

const repo = process.cwd();
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(portIndex >= 0 ? args[portIndex + 1] : 3100);
const skipServices = args.includes("--skip-services");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local demo port");

const localRoot = resolve(repo, ".local");
const source = "C:\\Users\\PC\\Documents\\ChatGPT\\voicepilot-ai\\.local\\supabase-loopback-source";
const junction = resolve(localRoot, "supabase-loopback-source");
const fixtureRoot = resolve(localRoot, `gateway-demo-${port}`);
const fixturePath = resolve(fixtureRoot, "voicepilot-local-loopback-fixtures.json");
const composeFile = resolve(junction, "docker", "docker-compose.yml");
const composeEnv = resolve(junction, "docker", ".env");
const fixtureScript = resolve(repo, "scripts", "local-supabase-fixtures.ps1");
const suffix = `gatewaydemo${port}`;
let junctionCreated = false;
let fixtureReady = false;
let servicesStarted = false;
let server;
let gateway;

const ps = (command) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: repo, encoding: "utf8", stdio: "inherit" });
const cleanup = async () => {
  if (server && !server.killed) { server.kill("SIGTERM"); server = undefined; }
  if (gateway) { try { await gateway.cleanup(); } catch {} gateway = undefined; }
  if (fixtureReady) { ps(`$env:VOICEPILOT_FIXTURE_ROOT='${fixtureRoot}'; $env:VOICEPILOT_FIXTURE_SUFFIX='${suffix}'; & '${fixtureScript}' -Action cleanup`); fixtureReady = false; }
  if (servicesStarted) { spawnSync("docker", ["compose", "--project-name", "voicepilot-local-loopback", "--file", composeFile, "--env-file", composeEnv, "down"], { cwd: repo, stdio: "ignore" }); servicesStarted = false; }
  if (junctionCreated && existsSync(junction)) { try { rmSync(junction, { recursive: true, force: true }); } catch {} junctionCreated = false; }
  if (existsSync(fixtureRoot)) { try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch {} }
};
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

try {
  if (!existsSync(junction)) { ps(`New-Item -ItemType Directory -Path '${localRoot}' -Force | Out-Null; New-Item -ItemType Junction -Path '${junction}' -Target '${source}' | Out-Null`); junctionCreated = true; }
  if (!existsSync(composeFile) || !existsSync(composeEnv)) throw new Error("Approved loopback Supabase bundle is missing");
  const envText = readFileSync(composeEnv, "utf8");
  if (!envText.includes("SUPABASE_PUBLIC_URL=http://127.0.0.1:55421")) throw new Error("Refusing non-loopback Supabase configuration");
  const anonKey = envText.match(/^ANON_KEY=(.*)$/m)?.[1]?.trim();
  if (!anonKey) throw new Error("Approved loopback Supabase public key is missing");
  if (!skipServices) { const started = spawnSync("docker", ["compose", "--project-name", "voicepilot-local-loopback", "--file", composeFile, "--env-file", composeEnv, "up", "-d"], { cwd: repo, stdio: "inherit" }); if (started.status !== 0) throw new Error("Unable to start approved loopback services"); servicesStarted = true; }
  const setup = ps(`$env:VOICEPILOT_FIXTURE_ROOT='${fixtureRoot}'; $env:VOICEPILOT_FIXTURE_SUFFIX='${suffix}'; & '${fixtureScript}' -Action setup`);
  if (setup.status !== 0 || !existsSync(fixturePath)) throw new Error("Synthetic fixture provisioning failed");
  fixtureReady = true;
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8").replace(/^\uFEFF/, ""));
  const identity = loadSyntheticFixtureIdentity(fixture);
  gateway = await startDisposableVoiceGateway({ fixtureIdentity: identity });
  const childEnv = { ...process.env, VOICEPILOT_FIXTURE_ROOT: fixtureRoot, PORT: String(port), NEXT_DIST_DIR: `.next-livekit-test-${port}`, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55421", NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, E2E_ISOLATED_AUTH: "true", VOICE_CONNECTIVITY_TEST_ENABLED: "true", VOICE_SESSION_POSTGRES_DISPOSABLE: "true", VOICE_OFFLINE_ADMISSION_TEST_ENABLED: "true", VOICE_OFFLINE_ADMISSION_SECRET: randomUUID(), VOICE_REALTIME_ENABLED: "false", VOICE_OUTBOUND_ENABLED: "false", VOICE_PROVIDER_ACTIVATION_ENABLED: "false", VOICE_PROVIDER_MODE: "mock", GATEWAY_DATABASE_URL: gateway.gatewayUrl, GATEWAY_ACTOR_ID: identity.actorId, GATEWAY_ORG_ID: identity.organizationId, GATEWAY_AGENT_ID: identity.agentId };
  server = spawn(process.execPath, [resolve(repo, "scripts", "start-isolated-auth-dev.mjs"), "dev"], { cwd: repo, env: childEnv, stdio: "inherit", windowsHide: true });
  for (let i = 0; i < 120; i++) { try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); if (i === 119) throw new Error("Gateway-aware demo server did not become ready"); }
  console.log(`OUTLIVO gateway-aware demo: http://127.0.0.1:${port}`);
  console.log("Synthetic fixtures and gateway database are active. Press Ctrl+C to clean up.");
  await new Promise((resolveWait) => server.on("exit", resolveWait));
} finally { await cleanup(); }
