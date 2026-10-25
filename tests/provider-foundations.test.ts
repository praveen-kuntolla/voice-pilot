import { describe, expect, it } from "vitest";
import { offlineProviderSet } from "@/lib/provider-contracts";
import { authorizeOfflineAction } from "@/lib/provider-safety";
import { MemoryReplayStore, signWebhook, verifyWebhook } from "@/lib/webhook-security";

const context = { sessionId: "s1", organizationId: "org-a", agentId: "agent-a" };
const campaign = { id: "c", organization_id: "org-a", agent_id: "agent-a", status: "draft", consent_required: true } as const;
const contact = { id: "contact", name: "Synthetic", organization_id: "org-a", consent_status: "granted" as const };

describe("offline provider foundations", () => {
  it("emits deterministic lifecycle events without external calls", async () => { const result = await offlineProviderSet().llm.run(context, "hello"); expect(result.ok).toBe(true); if (result.ok) expect(result.events.map((event) => event.kind)).toEqual(["started", "progress", "completed"]); });
  it("verifies signed, tenant-bound, single-use webhooks", () => { const replay = new MemoryReplayStore(); const input = { organizationId: "org-a", provider: "mock", eventId: "evt-1", timestamp: 1_700_000_000_000, body: '{"ok":true}' }; const signature = signWebhook("test-secret", input); const first = verifyWebhook({ ...input, signature }, "test-secret", replay, input.timestamp); expect(first.ok).toBe(true); expect(verifyWebhook({ ...input, signature }, "test-secret", replay, input.timestamp).ok).toBe(false); expect(verifyWebhook({ ...input, signature: "00" }, "test-secret", new MemoryReplayStore(), input.timestamp).ok).toBe(false); });
  it("fails closed for tenant, consent, emergency stop and usage limits", () => { expect(authorizeOfflineAction(campaign, contact, "org-b", { maxConcurrent: 1, currentConcurrent: 0, maxAttempts: 1, attempt: 0, maxSpendCents: 100, spentCents: 0, emergencyStop: false }).ok).toBe(false); expect(authorizeOfflineAction(campaign, contact, "org-a", { maxConcurrent: 1, currentConcurrent: 0, maxAttempts: 1, attempt: 0, maxSpendCents: 100, spentCents: 0, emergencyStop: true }).ok).toBe(false); expect(authorizeOfflineAction(campaign, contact, "org-a", { maxConcurrent: 1, currentConcurrent: 1, maxAttempts: 1, attempt: 0, maxSpendCents: 100, spentCents: 0, emergencyStop: false }).ok).toBe(false); });
});
