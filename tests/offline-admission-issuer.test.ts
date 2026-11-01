import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { issueOfflineSandboxAssertion } from "@/lib/offline-admission-issuer";
import { verifySignedAdmission } from "@/lib/signed-admission";

const base = { keyId: "test-key-1", organizationId: "org-a", agentId: "agent-a", actorId: "user-a", sessionId: "11111111-1111-4111-8111-111111111111", issuedAt: 1000, expiresAt: 2000, capability: "voice_sandbox" as const, maxDurationSeconds: 60, usageLimit: { inputCharacters: 100, outputCharacters: 200 } };
describe("offline admission issuer", () => {
  it("issues only under the explicit non-production test guard and verifies in the worker contract", () => { vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VOICE_OFFLINE_ADMISSION_TEST_ENABLED", "true"); const result = issueOfflineSandboxAssertion({ ...base, secret: "offline-test-signing-key" }); expect(verifySignedAdmission(result, key => key === "test-key-1" ? "offline-test-signing-key" : undefined, 1500, { organizationId: "org-a", agentId: "agent-a", actorId: "user-a" })).toBe(true); vi.unstubAllEnvs(); });
  it("round-trips a freshly serialized TypeScript assertion through the Python verifier", () => { vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VOICE_OFFLINE_ADMISSION_TEST_ENABLED", "true"); const result = issueOfflineSandboxAssertion({ ...base, secret: "offline-test-signing-key" }); const root = process.cwd(); const output = execFileSync("python", ["-m", "voice_agent.signed_admission"], { cwd: root, env: { ...process.env, PYTHONPATH: `${root}/workers/voice-agent` }, input: JSON.stringify({ ...result, testSecret: "offline-test-signing-key" }), encoding: "utf8" }); expect(JSON.parse(output).ok).toBe(true); vi.unstubAllEnvs(); });
  it("fails closed without the test guard", () => { vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VOICE_OFFLINE_ADMISSION_TEST_ENABLED", "false"); expect(() => issueOfflineSandboxAssertion({ ...base, secret: "offline-test-signing-key" })).toThrow(); vi.unstubAllEnvs(); });
});
