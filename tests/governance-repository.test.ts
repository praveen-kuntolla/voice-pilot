/**
 * Vitest unit tests for ProviderGovernanceRepository.
 * Uses a deterministic stub that satisfies the SupabaseClient shape.
 * No network, no Supabase, no Redis, no LiveKit.
 */
import { describe, it, expect, vi } from "vitest";

// Stub server-only at top level so the import resolves in test environment
vi.mock("server-only", () => ({}));

import {
  ProviderGovernanceRepository,
  GovernancePolicyUnavailable,
  GovernanceValidationError,
  type Provider,
} from "@/lib/provider-governance";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const USER  = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";
const EVENT = "66666666-6666-4666-8666-666666666666";

// ── Thenable stub: the chain returns a Promise at .eq() termination ───────────
/**
 * Build a fake Supabase client where every from().select().eq() chain
 * resolves to `response`. The chain is fully thenable — awaiting .eq()
 * works the same as awaiting an additional .order() or .maybeSingle().
 */
function tableStub(response: { data: unknown; error: { message: string } | null }): SupabaseClient {
  const thenable = {
    ...Promise.resolve(response),
    eq: (_c: string, _v: string) => thenable,
    order: (_c: string) => Promise.resolve(response),
    maybeSingle: () => Promise.resolve(response),
    single: () => Promise.resolve(response),
    then: Promise.resolve(response).then.bind(Promise.resolve(response)),
    catch: Promise.resolve(response).catch.bind(Promise.resolve(response)),
    finally: Promise.resolve(response).finally.bind(Promise.resolve(response)),
  };
  const selectChain = {
    eq: (_c: string, _v: string) => thenable,
    order: (_c: string) => Promise.resolve(response),
    maybeSingle: () => Promise.resolve(response),
    single: () => Promise.resolve(response),
  };
  const upsertResult = {
    select: (_q: string) => ({
      single: () => Promise.resolve(response),
    }),
  };
  return {
    from: (_table: string) => ({
      select: (_q: string) => selectChain,
      upsert: (_row: unknown, _opts?: unknown) => upsertResult,
    }),
    rpc: vi.fn().mockResolvedValue(response),
  } as unknown as SupabaseClient;
}

/**
 * Build a fake Supabase client where each table has its own response.
 */
function multiTableStub(
  tables: Record<string, { data: unknown; error: { message: string } | null }>,
): SupabaseClient {
  const makeChain = (response: { data: unknown; error: { message: string } | null }) => {
    const resolved = Promise.resolve(response);
    const thenable = {
      eq: (_c: string, _v: string) => thenable,
      order: (_c: string) => resolved,
      maybeSingle: () => resolved,
      single: () => resolved,
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
      finally: resolved.finally.bind(resolved),
    };
    return {
      eq: (_c: string, _v: string) => thenable,
      maybeSingle: () => resolved,
      single: () => resolved,
    };
  };

  return {
    from: (table: string) => {
      const response = tables[table] ?? { data: [], error: null };
      return {
        select: (_q: string) => makeChain(response),
        upsert: (_row: unknown, _opts?: unknown) => ({
          select: (_q: string) => ({ single: () => Promise.resolve(response) }),
        }),
      };
    },
    rpc: vi.fn(),
  } as unknown as SupabaseClient;
}

// ── Snapshot tests ────────────────────────────────────────────────────────────
describe("ProviderGovernanceRepository — loadSnapshot", () => {
  it("returns an empty-approval snapshot when no rows exist", async () => {
    const stub = multiTableStub({
      organization_provider_approvals: { data: [], error: null },
      agent_provider_approvals: { data: [], error: null },
      organization_privacy_policies: { data: [], error: null },
      organization_provider_quotas: { data: [], error: null },
    });
    const repo = new ProviderGovernanceRepository(stub);
    const snap = await repo.loadSnapshot(ORG_A, AGENT);
    expect(snap.organizationId).toBe(ORG_A);
    expect(snap.agentId).toBe(AGENT);
    expect(snap.organizationApprovals).toEqual([]);
    expect(snap.agentApprovals).toEqual([]);
    expect(snap.privacy).toBeNull();
    expect(snap.quotas).toEqual([]);
  });

  it("throws GovernancePolicyUnavailable on a database error", async () => {
    const stub = multiTableStub({
      organization_provider_approvals: { data: null, error: { message: "connection refused" } },
      agent_provider_approvals: { data: [], error: null },
      organization_privacy_policies: { data: [], error: null },
      organization_provider_quotas: { data: [], error: null },
    });
    const repo = new ProviderGovernanceRepository(stub);
    await expect(repo.loadSnapshot(ORG_A, AGENT)).rejects.toBeInstanceOf(GovernancePolicyUnavailable);
  });

  it("throws GovernancePolicyUnavailable when agent approval belongs to wrong org", async () => {
    const badApproval = {
      organization_id: ORG_B, // cross-tenant!
      agent_id: AGENT,
      provider: "deepgram",
      approved_by: USER,
      revoked_at: null,
    };
    const stub = multiTableStub({
      organization_provider_approvals: { data: [], error: null },
      agent_provider_approvals: { data: [badApproval], error: null },
      organization_privacy_policies: { data: [], error: null },
      organization_provider_quotas: { data: [], error: null },
    });
    const repo = new ProviderGovernanceRepository(stub);
    await expect(repo.loadSnapshot(ORG_A, AGENT)).rejects.toBeInstanceOf(GovernancePolicyUnavailable);
  });
});

// ── Org approval tests ────────────────────────────────────────────────────────
describe("ProviderGovernanceRepository — org approvals", () => {
  it("listOrgApprovals returns empty array when none exist", async () => {
    const stub = tableStub({ data: [], error: null });
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.listOrgApprovals(ORG_A);
    expect(result).toEqual([]);
  });

  it("upsertOrgApproval returns the written approval", async () => {
    const row = {
      organization_id: ORG_A,
      provider: "deepgram",
      credential_reference: "ref-abc-123",
      approved_by: USER,
      revoked_at: null,
    };
    const stub = tableStub({ data: row, error: null });
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.upsertOrgApproval({
      organizationId: ORG_A,
      provider: "deepgram" as Provider,
      credentialReference: "ref-abc-123",
      approvedBy: USER,
    });
    expect(result.organization_id).toBe(ORG_A);
    expect(result.provider).toBe("deepgram");
    expect(result.credential_reference).toBe("ref-abc-123");
  });

  it("revokeOrgApproval calls the RPC and returns the boolean result", async () => {
    const rpc = vi.fn(async function () { return { data: true, error: null }; });
    const stub = { from: () => ({}), rpc } as unknown as SupabaseClient;
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.revokeOrgApproval(ORG_A, "deepgram");
    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith("revoke_provider_approval", expect.objectContaining({
      p_organization_id: ORG_A,
      p_provider: "deepgram",
      p_target: "organization",
    }));
  });

  it("revokeOrgApproval throws GovernancePolicyUnavailable on DB error", async () => {
    const rpc = vi.fn(async function () { return { data: null, error: { message: "rpc failed" } }; });
    const stub = { from: () => ({}), rpc } as unknown as SupabaseClient;
    const repo = new ProviderGovernanceRepository(stub);
    await expect(repo.revokeOrgApproval(ORG_A, "openai")).rejects.toBeInstanceOf(GovernancePolicyUnavailable);
  });
});

// ── Privacy policy tests ──────────────────────────────────────────────────────
describe("ProviderGovernanceRepository — privacy policy", () => {
  it("getPrivacyPolicy returns null when no policy exists", async () => {
    const stub = tableStub({ data: null, error: null });
    const repo = new ProviderGovernanceRepository(stub);
    const policy = await repo.getPrivacyPolicy(ORG_A);
    expect(policy).toBeNull();
  });

  it("upsertPrivacyPolicy returns the saved policy", async () => {
    const row = {
      organization_id: ORG_A,
      audio_retention_days: 0,
      transcript_retention_days: 30,
      consent_required: true,
      permitted_regions: ["us-east-1"],
      redact_diagnostics: true,
      updated_by: USER,
    };
    const stub = tableStub({ data: row, error: null });
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.upsertPrivacyPolicy({
      organizationId: ORG_A,
      audioRetentionDays: 0,
      transcriptRetentionDays: 30,
      consentRequired: true,
      permittedRegions: ["us-east-1"],
      redactDiagnostics: true,
      updatedBy: USER,
    });
    expect(result.consent_required).toBe(true);
    expect(result.permitted_regions).toEqual(["us-east-1"]);
  });
});

// ── Quota tests ───────────────────────────────────────────────────────────────
describe("ProviderGovernanceRepository — quotas", () => {
  it("upsertQuota returns the saved quota", async () => {
    const row = {
      organization_id: ORG_A,
      provider: "openai",
      max_session_estimated_cost: 0.5,
      max_organization_estimated_cost: 100,
      max_concurrent_sessions: 5,
      updated_by: USER,
    };
    const stub = tableStub({ data: row, error: null });
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.upsertQuota({
      organizationId: ORG_A,
      provider: "openai",
      maxSessionEstimatedCost: 0.5,
      maxOrganizationEstimatedCost: 100,
      maxConcurrentSessions: 5,
      updatedBy: USER,
    });
    expect(result.max_concurrent_sessions).toBe(5);
    expect(result.max_session_estimated_cost).toBe(0.5);
  });
});

// ── Usage / audit tests ───────────────────────────────────────────────────────
describe("ProviderGovernanceRepository — usage and audit", () => {
  it("recordUsage calls record_provider_usage RPC with correct args", async () => {
    const rpc = vi.fn(async function () { return { data: true, error: null }; });
    const stub = { from: () => ({}), rpc } as unknown as SupabaseClient;
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.recordUsage({
      eventId: EVENT,
      organizationId: ORG_A,
      agentId: AGENT,
      provider: "deepgram",
      sessionId: SESSION,
      metric: "stt_seconds",
      quantity: 60,
      estimatedCost: 0.0098,
    });
    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_provider_usage", expect.objectContaining({
      p_event_id: EVENT,
      p_organization_id: ORG_A,
      p_metric: "stt_seconds",
      p_quantity: 60,
    }));
  });

  it("recordUsage throws GovernanceValidationError for invalid metric", async () => {
    const stub = tableStub({ data: null, error: null });
    const repo = new ProviderGovernanceRepository(stub);
    await expect(
      repo.recordUsage({
        eventId: EVENT, organizationId: ORG_A, agentId: AGENT,
        provider: "deepgram", sessionId: SESSION,
        metric: "invalid_metric" as "stt_seconds",
        quantity: 1, estimatedCost: 0,
      }),
    ).rejects.toBeInstanceOf(GovernanceValidationError);
  });

  it("recordUsage — deduplicated event returns false (idempotent)", async () => {
    const rpc = vi.fn(async function () { return { data: false, error: null }; });
    const stub = { from: () => ({}), rpc } as unknown as SupabaseClient;
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.recordUsage({
      eventId: EVENT, organizationId: ORG_A, agentId: AGENT,
      provider: "elevenlabs", sessionId: SESSION,
      metric: "tts_characters", quantity: 500, estimatedCost: 0.005,
    });
    expect(result).toBe(false);
  });

  it("reserveSession returns true when slot is available", async () => {
    const rpc = vi.fn(async function () { return { data: true, error: null }; });
    const stub = { from: () => ({}), rpc } as unknown as SupabaseClient;
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.reserveSession({
      organizationId: ORG_A, agentId: AGENT,
      provider: "openai", sessionId: SESSION,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith("reserve_provider_session", expect.objectContaining({
      p_organization_id: ORG_A,
      p_provider: "openai",
    }));
  });

  it("getUsageSummary calls get_usage_summary RPC", async () => {
    const rows = [{ provider: "deepgram", period_start: "2026-10-01", estimated_cost: 1.23 }];
    const rpc = vi.fn(async function () { return { data: rows, error: null }; });
    const stub = { from: () => ({}), rpc } as unknown as SupabaseClient;
    const repo = new ProviderGovernanceRepository(stub);
    const result = await repo.getUsageSummary(ORG_A);
    expect(result[0].provider).toBe("deepgram");
    expect(result[0].estimated_cost).toBe(1.23);
  });

  it("getAuditEvents calls get_audit_events RPC with bounded limit (capped at 200)", async () => {
    const rpc = vi.fn(async function () { return { data: [], error: null }; });
    const stub = { from: () => ({}), rpc } as unknown as SupabaseClient;
    const repo = new ProviderGovernanceRepository(stub);
    await repo.getAuditEvents(ORG_A, 999); // should be capped at 200
    expect(rpc).toHaveBeenCalledWith("get_audit_events", { p_organization_id: ORG_A, p_limit: 200 });
  });
});
