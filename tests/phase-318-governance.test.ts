import { describe, expect, it } from "vitest";
import { auditQuerySchema, filterAuditEvents } from "@/lib/governance-audit";
import { evaluateMockSimulationPreflight } from "@/lib/simulation-preflight";

const org = "11111111-1111-4111-8111-111111111111";
const agent = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const policy = { organizationId: org, agentId: agent, organizationApprovals: [], agentApprovals: [], privacy: null, quotas: [] };

describe("governance audit filtering", () => {
  const rows = [
    { id: "a", actor_id: actor, action: "approval_granted", provider: "openai", created_at: "2026-10-01T10:00:00.000Z", metadata: {} },
    { id: "b", actor_id: null, action: "approval_revoked", provider: "deepgram", created_at: "2026-10-02T10:00:00.000Z", metadata: { agent_id: agent } },
    { id: "c", actor_id: actor, action: "quota_changed", provider: "openai", created_at: "2026-10-03T10:00:00.000Z", metadata: {} },
  ];
  it("filters the already organization-scoped result set and paginates it", () => {
    const query = auditQuerySchema.parse({ action: "approval_granted", page: "1", pageSize: "1" });
    expect(filterAuditEvents(rows, query)).toMatchObject({ total: 1, page: 1, events: [{ id: "a" }] });
  });
  it("supports actor, date, and safe text searches", () => {
    expect(filterAuditEvents(rows, auditQuerySchema.parse({ actorId: actor })).total).toBe(2);
    expect(filterAuditEvents(rows, auditQuerySchema.parse({ from: "2026-10-02", to: "2026-10-02" })).events[0].id).toBe("b");
    expect(filterAuditEvents(rows, auditQuerySchema.parse({ search: agent })).events[0].id).toBe("b");
  });
});

describe("mock simulation preflight", () => {
  const base = { id: agent, organization_id: org, name: "Support", instructions: "Be helpful", language: "en-US", status: "draft" };
  it("allows a complete selected-organization agent using mock providers only", () => {
    expect(evaluateMockSimulationPreflight({ agent: base, organizationId: org, policy }).allowed).toBe(true);
  });
  it("fails closed for cross-organization and archived agents", () => {
    expect(evaluateMockSimulationPreflight({ agent: { ...base, organization_id: "other" }, organizationId: org, policy }).allowed).toBe(false);
    expect(evaluateMockSimulationPreflight({ agent: { ...base, status: "archived" }, organizationId: org, policy }).allowed).toBe(false);
  });
});
