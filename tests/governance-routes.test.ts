/**
 * Vitest tests for governance API routes.
 *
 * All vi.mock() calls are at the top level so Vitest can hoist them correctly.
 * Per-test membership state is controlled via a mutable `authState` variable.
 * No Supabase, no Redis, no network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Required stubs (all top-level for Vitest hoisting) ────────────────────────
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => undefined,
    getAll: () => [],
    set: () => {},
  }),
}));

// ── Auth state controlled from test code ──────────────────────────────────────
const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const authState = {
  user: null as { id: string; email?: string } | null,
  membership: null as { organization_id: string; role: string } | null,
};

vi.mock("@/lib/authz", () => ({
  currentMembership: () => Promise.resolve({
    user: authState.user,
    membership: authState.membership,
    s: {},
    organizations: authState.membership ? [authState.membership] : [],
  }),
  canWrite: (role: string) => role === "admin" || role === "owner",
}));

// ── Supabase client stubs ─────────────────────────────────────────────────────
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async function () { return {}; }),
}));
vi.mock("@/lib/supabase/governance", () => ({
  createGovernanceServiceClient: vi.fn(function () { return {}; }),
}));

// ── Governance repository stub ────────────────────────────────────────────────
const mockRepo = {
  listOrgApprovals: vi.fn(async function () { return []; }),
  upsertOrgApproval: vi.fn(async function () { return {}; }),
  revokeOrgApproval: vi.fn(async function () { return true; }),
  listAgentApprovals: vi.fn(async function () { return []; }),
  upsertAgentApproval: vi.fn(async function () { return {}; }),
  revokeAgentApproval: vi.fn(async function () { return true; }),
  getPrivacyPolicy: vi.fn(async function () { return null; }),
  upsertPrivacyPolicy: vi.fn(async function () { return {}; }),
  listQuotas: vi.fn(async function () { return []; }),
  upsertQuota: vi.fn(async function () { return {}; }),
  getUsageSummary: vi.fn(async function () { return []; }),
  getAuditEvents: vi.fn(async function () { return []; }),
  reserveSession: vi.fn(async function () { return true; }),
  recordUsage: vi.fn(async function () { return true; }),
};

vi.mock("@/lib/provider-governance", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ProviderGovernanceRepository: vi.fn(function (this: any) {
    Object.assign(this, mockRepo);
  }),
  GovernancePolicyUnavailable: class GovernancePolicyUnavailable extends Error {},
  GovernanceValidationError: class GovernanceValidationError extends Error {},
  SUPPORTED_PROVIDERS: ["deepgram", "openai", "elevenlabs"],
}));

// ── State helpers ─────────────────────────────────────────────────────────────
function asAdmin() {
  authState.user = { id: USER, email: "admin@example.com" };
  authState.membership = { organization_id: ORG, role: "admin" };
}
function asAnon() {
  authState.user = null;
  authState.membership = null;
}
function asMember() {
  authState.user = { id: USER };
  authState.membership = { organization_id: ORG, role: "member" };
}

function jsonPost(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "origin": "http://localhost:3000",
      "host": "localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

// ── Reset state before each test ─────────────────────────────────────────────
beforeEach(() => {
  asAnon();
  // Reset per-test return values without wiping function bodies
  mockRepo.listOrgApprovals.mockImplementation(async function () { return []; });
  mockRepo.upsertOrgApproval.mockImplementation(async function () { return {}; });
  mockRepo.revokeOrgApproval.mockImplementation(async function () { return true; });
  mockRepo.listAgentApprovals.mockImplementation(async function () { return []; });
  mockRepo.upsertAgentApproval.mockImplementation(async function () { return {}; });
  mockRepo.revokeAgentApproval.mockImplementation(async function () { return true; });
  mockRepo.getPrivacyPolicy.mockImplementation(async function () { return null; });
  mockRepo.upsertPrivacyPolicy.mockImplementation(async function () { return {}; });
  mockRepo.listQuotas.mockImplementation(async function () { return []; });
  mockRepo.upsertQuota.mockImplementation(async function () { return {}; });
  mockRepo.getUsageSummary.mockImplementation(async function () { return []; });
  mockRepo.getAuditEvents.mockImplementation(async function () { return []; });
  mockRepo.reserveSession.mockImplementation(async function () { return true; });
  mockRepo.recordUsage.mockImplementation(async function () { return true; });
});

// ── GET /api/governance/org-approvals ─────────────────────────────────────────
describe("GET /api/governance/org-approvals", () => {
  it("rejects unauthenticated requests", async () => {
    asAnon();
    const { GET } = await import("@/app/api/governance/org-approvals/route");
    expect((await GET()).status).toBe(401);
  });

  it("rejects non-admin members", async () => {
    asMember();
    const { GET } = await import("@/app/api/governance/org-approvals/route");
    expect((await GET()).status).toBe(403);
  });

  it("returns approvals list for admin", async () => {
    asAdmin();
    const fakeApprovals = [{ organization_id: ORG, provider: "deepgram", credential_reference: "ref-1", approved_by: USER }];
    mockRepo.listOrgApprovals.mockResolvedValue(fakeApprovals as never);
    const { GET } = await import("@/app/api/governance/org-approvals/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { approvals: unknown[] };
    expect(body.approvals).toHaveLength(1);
  });
});

// ── POST /api/governance/org-approvals ───────────────────────────────────────
describe("POST /api/governance/org-approvals", () => {
  it("rejects unauthenticated requests", async () => {
    asAnon();
    const { POST } = await import("@/app/api/governance/org-approvals/route");
    expect((await POST(jsonPost(
      "http://localhost:3000/api/governance/org-approvals",
      { provider: "deepgram", credential_reference: "ref" },
    ))).status).toBe(401);
  });

  it("rejects cross-origin requests", async () => {
    asAdmin();
    const { POST } = await import("@/app/api/governance/org-approvals/route");
    const req = new Request("http://localhost:3000/api/governance/org-approvals", {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://evil.example.com", "host": "localhost:3000" },
      body: JSON.stringify({ provider: "deepgram", credential_reference: "ref" }),
    });
    expect((await POST(req)).status).toBe(403);
  });

  it("rejects invalid provider values", async () => {
    asAdmin();
    const { POST } = await import("@/app/api/governance/org-approvals/route");
    expect((await POST(jsonPost(
      "http://localhost:3000/api/governance/org-approvals",
      { provider: "badprovider", credential_reference: "ref" },
    ))).status).toBe(400);
  });

  it("creates an approval for a valid admin request", async () => {
    asAdmin();
    const approval = { organization_id: ORG, provider: "deepgram", credential_reference: "ref-abc", approved_by: USER };
    mockRepo.upsertOrgApproval.mockResolvedValue(approval);
    const { POST } = await import("@/app/api/governance/org-approvals/route");
    const res = await POST(jsonPost(
      "http://localhost:3000/api/governance/org-approvals",
      { provider: "deepgram", credential_reference: "ref-abc" },
    ));
    expect(res.status).toBe(201);
    const body = await res.json() as { approval: { provider: string } };
    expect(body.approval.provider).toBe("deepgram");
  });
});

// ── GET /api/governance/privacy-policy ───────────────────────────────────────
describe("GET /api/governance/privacy-policy", () => {
  it("rejects unauthenticated", async () => {
    asAnon();
    const { GET } = await import("@/app/api/governance/privacy-policy/route");
    expect((await GET()).status).toBe(401);
  });

  it("returns null policy when none configured", async () => {
    asAdmin();
    mockRepo.getPrivacyPolicy.mockResolvedValue(null);
    const { GET } = await import("@/app/api/governance/privacy-policy/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { policy: null };
    expect(body.policy).toBeNull();
  });
});

// ── PUT /api/governance/privacy-policy ───────────────────────────────────────
describe("PUT /api/governance/privacy-policy", () => {
  it("rejects retention days > 365", async () => {
    asAdmin();
    const { PUT } = await import("@/app/api/governance/privacy-policy/route");
    const res = await PUT(jsonPost("http://localhost:3000/api/governance/privacy-policy", {
      audio_retention_days: 999, transcript_retention_days: 30,
      consent_required: true, permitted_regions: [], redact_diagnostics: true,
    }, "PUT"));
    expect(res.status).toBe(400);
  });

  it("saves a valid privacy policy", async () => {
    asAdmin();
    const policy = {
      organization_id: ORG, audio_retention_days: 0, transcript_retention_days: 30,
      consent_required: true, permitted_regions: [], redact_diagnostics: true, updated_by: USER,
    };
    mockRepo.upsertPrivacyPolicy.mockResolvedValue(policy);
    const { PUT } = await import("@/app/api/governance/privacy-policy/route");
    const res = await PUT(jsonPost("http://localhost:3000/api/governance/privacy-policy", {
      audio_retention_days: 0, transcript_retention_days: 30,
      consent_required: true, permitted_regions: [], redact_diagnostics: true,
    }, "PUT"));
    expect(res.status).toBe(200);
    const body = await res.json() as { policy: { consent_required: boolean } };
    expect(body.policy.consent_required).toBe(true);
  });
});

// ── GET /api/governance/quotas ────────────────────────────────────────────────
describe("GET /api/governance/quotas", () => {
  it("returns quotas list for admin", async () => {
    asAdmin();
    mockRepo.listQuotas.mockResolvedValue([]);
    const { GET } = await import("@/app/api/governance/quotas/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { quotas: unknown[] };
    expect(body.quotas).toEqual([]);
  });
});

// ── PUT /api/governance/quotas ────────────────────────────────────────────────
describe("PUT /api/governance/quotas", () => {
  it("rejects negative cost values", async () => {
    asAdmin();
    const { PUT } = await import("@/app/api/governance/quotas/route");
    const res = await PUT(jsonPost("http://localhost:3000/api/governance/quotas", {
      provider: "openai", max_session_estimated_cost: -1,
      max_organization_estimated_cost: 100, max_concurrent_sessions: 5,
    }, "PUT"));
    expect(res.status).toBe(400);
  });

  it("saves valid quota", async () => {
    asAdmin();
    const quota = { organization_id: ORG, provider: "openai", max_session_estimated_cost: 0.5, max_organization_estimated_cost: 100, max_concurrent_sessions: 5 };
    mockRepo.upsertQuota.mockResolvedValue(quota);
    const { PUT } = await import("@/app/api/governance/quotas/route");
    const res = await PUT(jsonPost("http://localhost:3000/api/governance/quotas", {
      provider: "openai", max_session_estimated_cost: 0.5,
      max_organization_estimated_cost: 100, max_concurrent_sessions: 5,
    }, "PUT"));
    expect(res.status).toBe(200);
    const body = await res.json() as { quota: { max_concurrent_sessions: number } };
    expect(body.quota.max_concurrent_sessions).toBe(5);
  });
});

// ── GET /api/governance/agent-approvals ──────────────────────────────────────
describe("GET /api/governance/agent-approvals", () => {
  it("requires valid agent_id query parameter", async () => {
    asAdmin();
    const { GET } = await import("@/app/api/governance/agent-approvals/route");
    const req = new Request("http://localhost:3000/api/governance/agent-approvals"); // no agent_id
    expect((await GET(req)).status).toBe(400);
  });

  it("returns agent approvals for a valid agent_id", async () => {
    asAdmin();
    mockRepo.listAgentApprovals.mockResolvedValue([]);
    const { GET } = await import("@/app/api/governance/agent-approvals/route");
    const req = new Request(`http://localhost:3000/api/governance/agent-approvals?agent_id=${AGENT}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { approvals: unknown[] };
    expect(body.approvals).toEqual([]);
  });

  it("rejects non-UUID agent_id", async () => {
    asAdmin();
    const { GET } = await import("@/app/api/governance/agent-approvals/route");
    const req = new Request("http://localhost:3000/api/governance/agent-approvals?agent_id=not-a-uuid");
    expect((await GET(req)).status).toBe(400);
  });
});

// ── GET /api/governance/usage ─────────────────────────────────────────────────
describe("GET /api/governance/usage", () => {
  it("rejects unauthenticated", async () => {
    asAnon();
    const { GET } = await import("@/app/api/governance/usage/route");
    const req = new Request("http://localhost:3000/api/governance/usage");
    expect((await GET(req)).status).toBe(401);
  });

  it("returns usage summary for admin", async () => {
    asAdmin();
    const summary = [{ provider: "deepgram", period_start: "2026-10-01", estimated_cost: 1.23 }];
    mockRepo.getUsageSummary.mockResolvedValue(summary as never);
    const { GET } = await import("@/app/api/governance/usage/route");
    const req = new Request("http://localhost:3000/api/governance/usage");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: unknown[] };
    expect(body.summary).toHaveLength(1);
  });
});

// ── GET /api/governance/audit ─────────────────────────────────────────────────
describe("GET /api/governance/audit", () => {
  it("rejects unauthenticated", async () => {
    asAnon();
    const { GET } = await import("@/app/api/governance/audit/route");
    const req = new Request("http://localhost:3000/api/governance/audit");
    expect((await GET(req)).status).toBe(401);
  });

  it("returns audit events for admin", async () => {
    asAdmin();
    const events = [{
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      actor_id: USER, action: "approval_granted",
      provider: "deepgram", correlation_id: null,
      metadata: {}, created_at: new Date().toISOString(),
    }];
    mockRepo.getAuditEvents.mockResolvedValue(events as never);
    const { GET } = await import("@/app/api/governance/audit/route");
    const req = new Request("http://localhost:3000/api/governance/audit");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it("caps limit at 200", async () => {
    asAdmin();
    mockRepo.getAuditEvents.mockResolvedValue([]);
    const { GET } = await import("@/app/api/governance/audit/route");
    const req = new Request("http://localhost:3000/api/governance/audit?limit=9999");
    await GET(req);
    expect(mockRepo.getAuditEvents).toHaveBeenCalledWith(ORG, 200);
  });
});

// ── POST /api/governance/org-approvals/revoke ────────────────────────────────
describe("POST /api/governance/org-approvals/revoke", () => {
  it("rejects member role", async () => {
    asMember();
    const { POST } = await import("@/app/api/governance/org-approvals/revoke/route");
    const req = jsonPost("http://localhost:3000/api/governance/org-approvals/revoke", { provider: "deepgram" });
    expect((await POST(req)).status).toBe(403);
  });

  it("revokes an active approval for admin", async () => {
    asAdmin();
    mockRepo.revokeOrgApproval.mockResolvedValue(true);
    const { POST } = await import("@/app/api/governance/org-approvals/revoke/route");
    const req = jsonPost("http://localhost:3000/api/governance/org-approvals/revoke", { provider: "deepgram" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { revoked: boolean };
    expect(body.revoked).toBe(true);
  });
});

// ── POST /api/governance/agent-approvals/revoke ──────────────────────────────
describe("POST /api/governance/agent-approvals/revoke", () => {
  it("rejects missing agent_id", async () => {
    asAdmin();
    const { POST } = await import("@/app/api/governance/agent-approvals/revoke/route");
    const req = jsonPost("http://localhost:3000/api/governance/agent-approvals/revoke",
      { provider: "deepgram" }); // no agent_id
    expect((await POST(req)).status).toBe(400);
  });

  it("revokes an agent approval for admin", async () => {
    asAdmin();
    mockRepo.revokeAgentApproval.mockResolvedValue(true);
    const { POST } = await import("@/app/api/governance/agent-approvals/revoke/route");
    const req = jsonPost("http://localhost:3000/api/governance/agent-approvals/revoke",
      { provider: "deepgram", agent_id: AGENT });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { revoked: boolean };
    expect(body.revoked).toBe(true);
  });
});
