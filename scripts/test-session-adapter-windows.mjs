import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { startDisposableVoiceGateway } from "./lib/disposable-voice-gateway.mjs";

const gateway = await startDisposableVoiceGateway();
let passed = false;
try {
  const env = { ...process.env, GATEWAY_DATABASE_URL: gateway.gatewayUrl, GATEWAY_ACTOR_ID: gateway.actorId, GATEWAY_ORG_ID: gateway.organizationId, GATEWAY_AGENT_ID: gateway.agentId };
  const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "tests/postgres-voice-session-adapter.integration.test.ts"], { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  passed = result.status === 0;
} finally { await gateway.cleanup(); }
if (passed) console.log("SESSION_ADAPTER_WINDOWS_OK randomized disposable gateway database cleaned");
