import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Provider enum ─────────────────────────────────────────────────────────────
const provider = z.enum(["deepgram", "openai", "elevenlabs"]);
export type Provider = z.infer<typeof provider>;
export const SUPPORTED_PROVIDERS: Provider[] = ["deepgram", "openai", "elevenlabs"];

// ── Zod schemas ───────────────────────────────────────────────────────────────
export const providerApprovalSchema = z.object({
  organization_id: z.string().uuid(),
  provider,
  credential_reference: z.string().min(3).max(256),
  approved_by: z.string().uuid(),
  approved_at: z.string().datetime({ offset: true }).optional(),
  revoked_at: z.string().datetime({ offset: true }).nullable().optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type ProviderApproval = z.infer<typeof providerApprovalSchema>;

export const agentApprovalSchema = z.object({
  organization_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  provider,
  approved_by: z.string().uuid(),
  approved_at: z.string().datetime({ offset: true }).optional(),
  revoked_at: z.string().datetime({ offset: true }).nullable().optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type AgentApproval = z.infer<typeof agentApprovalSchema>;

export const privacyPolicySchema = z.object({
  organization_id: z.string().uuid(),
  audio_retention_days: z.number().int().min(0).max(365),
  transcript_retention_days: z.number().int().min(0).max(365),
  consent_required: z.boolean(),
  permitted_regions: z.array(z.string().min(2).max(20)),
  redact_diagnostics: z.boolean(),
  updated_by: z.string().uuid().optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type PrivacyPolicy = z.infer<typeof privacyPolicySchema>;

export const providerQuotaSchema = z.object({
  organization_id: z.string().uuid(),
  provider,
  max_session_estimated_cost: z.number().nonnegative(),
  max_organization_estimated_cost: z.number().nonnegative(),
  max_concurrent_sessions: z.number().int().nonnegative(),
  updated_by: z.string().uuid().optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type ProviderQuota = z.infer<typeof providerQuotaSchema>;

export const usageSummarySchema = z.object({
  provider,
  period_start: z.string(),
  estimated_cost: z.number(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  action: z.enum([
    "approval_granted", "approval_updated", "approval_revoked", "privacy_policy_changed",
    "provider_configuration_changed", "quota_changed", "session_rejected",
    "budget_exceeded", "credential_reference_changed",
  ]),
  provider: provider.nullable(),
  correlation_id: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const providerPolicySnapshotSchema = z.object({
  organizationId: z.string().uuid(),
  agentId: z.string().uuid(),
  organizationApprovals: z.array(providerApprovalSchema),
  agentApprovals: z.array(agentApprovalSchema),
  privacy: privacyPolicySchema.nullable(),
  quotas: z.array(providerQuotaSchema),
});
export type ProviderPolicySnapshot = z.infer<typeof providerPolicySnapshotSchema>;

export type UsageRecord = {
  eventId: string;
  organizationId: string;
  agentId: string;
  provider: Provider;
  sessionId: string;
  metric: "stt_seconds" | "llm_input_tokens" | "llm_output_tokens" | "tts_characters";
  quantity: number;
  estimatedCost: number;
};

// ── Errors ────────────────────────────────────────────────────────────────────
export class GovernancePolicyUnavailable extends Error {}
export class GovernancePermissionDenied extends Error {}
export class GovernanceValidationError extends Error {}

// ── Repository ────────────────────────────────────────────────────────────────

/**
 * ProviderGovernanceRepository wraps all database operations for provider
 * governance (approvals, privacy policy, quotas, usage, audit).
 *
 * Accepts a real SupabaseClient. For API routes that act on behalf of an
 * authenticated user, pass the SSR cookie client (anon key + user session).
 * Authenticated administrative reads use the SSR cookie client. Internal worker
 * accounting RPCs require a separately injected server-only service client.
 *
 * Test code may pass a stub that satisfies the SupabaseClient shape.
 */
export class ProviderGovernanceRepository {
  constructor(private readonly db: SupabaseClient) {}

  // ── Policy snapshot (used by worker config boundary) ─────────────────────
  async loadSnapshot(organizationId: string, agentId: string): Promise<ProviderPolicySnapshot> {
    const [orgApprovals, agentApprovals, privacy, quotas] = await Promise.all([
      this.db
        .from("organization_provider_approvals")
        .select("organization_id,provider,credential_reference,approved_by,approved_at,revoked_at,updated_at")
        .eq("organization_id", organizationId),
      this.db
        .from("agent_provider_approvals")
        .select("organization_id,agent_id,provider,approved_by,approved_at,revoked_at,updated_at")
        .eq("agent_id", agentId),
      this.db
        .from("organization_privacy_policies")
        .select("organization_id,audio_retention_days,transcript_retention_days,consent_required,permitted_regions,redact_diagnostics,updated_by,updated_at")
        .eq("organization_id", organizationId),
      this.db
        .from("organization_provider_quotas")
        .select("organization_id,provider,max_session_estimated_cost,max_organization_estimated_cost,max_concurrent_sessions,updated_by,updated_at")
        .eq("organization_id", organizationId),
    ]);

    if ([orgApprovals, agentApprovals, privacy, quotas].some((r) => r.error)) {
      throw new GovernancePolicyUnavailable("Provider governance policy could not be loaded");
    }

    const parsed = providerPolicySnapshotSchema.safeParse({
      organizationId,
      agentId,
      organizationApprovals: orgApprovals.data ?? [],
      agentApprovals: agentApprovals.data ?? [],
      privacy: Array.isArray(privacy.data) ? (privacy.data[0] ?? null) : null,
      quotas: quotas.data ?? [],
    });
    if (!parsed.success) throw new GovernancePolicyUnavailable("Provider governance policy is invalid");

    // Extra tenant guard: every agent approval must belong to this org + agent
    if (
      parsed.data.agentApprovals.some(
        (a) => a.organization_id !== organizationId || a.agent_id !== agentId,
      )
    ) {
      throw new GovernancePolicyUnavailable("Provider governance tenant mismatch");
    }

    return parsed.data;
  }

  // ── Org provider approvals ────────────────────────────────────────────────
  async listOrgApprovals(organizationId: string): Promise<ProviderApproval[]> {
    const { data, error } = await this.db
      .from("organization_provider_approvals")
      .select("organization_id,provider,credential_reference,approved_by,approved_at,revoked_at,updated_at")
      .eq("organization_id", organizationId)
      .order("provider");
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return z.array(providerApprovalSchema).parse(data ?? []);
  }

  async upsertOrgApproval(input: {
    organizationId: string;
    provider: Provider;
    credentialReference: string;
    approvedBy: string;
  }): Promise<ProviderApproval> {
    const { organizationId, provider: p, credentialReference, approvedBy } = input;
    const { data, error } = await this.db
      .from("organization_provider_approvals")
      .upsert(
        {
          organization_id: organizationId,
          provider: p,
          credential_reference: credentialReference,
          approved_by: approvedBy,
          revoked_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,provider" },
      )
      .select("organization_id,provider,credential_reference,approved_by,approved_at,revoked_at,updated_at")
      .single();
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return providerApprovalSchema.parse(data);
  }

  async revokeOrgApproval(
    organizationId: string,
    p: Provider,
  ): Promise<boolean> {
    // Delegates to the DB RPC which enforces is_org_admin and emits audit event
    const { data, error } = await this.db.rpc("revoke_provider_approval", {
      p_organization_id: organizationId,
      p_provider: p,
      p_target: "organization",
      p_agent_id: null,
    });
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return data === true;
  }

  // ── Agent provider approvals ──────────────────────────────────────────────
  async listAgentApprovals(organizationId: string, agentId: string): Promise<AgentApproval[]> {
    const { data, error } = await this.db
      .from("agent_provider_approvals")
      .select("organization_id,agent_id,provider,approved_by,approved_at,revoked_at,updated_at")
      .eq("organization_id", organizationId)
      .eq("agent_id", agentId)
      .order("provider");
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return z.array(agentApprovalSchema).parse(data ?? []);
  }

  async upsertAgentApproval(input: {
    organizationId: string;
    agentId: string;
    provider: Provider;
    approvedBy: string;
  }): Promise<AgentApproval> {
    const { organizationId, agentId, provider: p, approvedBy } = input;
    const { data, error } = await this.db
      .from("agent_provider_approvals")
      .upsert(
        {
          organization_id: organizationId,
          agent_id: agentId,
          provider: p,
          approved_by: approvedBy,
          revoked_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id,provider" },
      )
      .select("organization_id,agent_id,provider,approved_by,approved_at,revoked_at,updated_at")
      .single();
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return agentApprovalSchema.parse(data);
  }

  async revokeAgentApproval(
    organizationId: string,
    agentId: string,
    p: Provider,
  ): Promise<boolean> {
    const { data, error } = await this.db.rpc("revoke_provider_approval", {
      p_organization_id: organizationId,
      p_provider: p,
      p_target: "agent",
      p_agent_id: agentId,
    });
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return data === true;
  }

  // ── Privacy policy ────────────────────────────────────────────────────────
  async getPrivacyPolicy(organizationId: string): Promise<PrivacyPolicy | null> {
    const { data, error } = await this.db
      .from("organization_privacy_policies")
      .select("organization_id,audio_retention_days,transcript_retention_days,consent_required,permitted_regions,redact_diagnostics,updated_by,updated_at")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new GovernancePolicyUnavailable(error.message);
    if (!data) return null;
    return privacyPolicySchema.parse(data);
  }

  async upsertPrivacyPolicy(input: {
    organizationId: string;
    audioRetentionDays: number;
    transcriptRetentionDays: number;
    consentRequired: boolean;
    permittedRegions: string[];
    redactDiagnostics: boolean;
    updatedBy: string;
  }): Promise<PrivacyPolicy> {
    const { data, error } = await this.db
      .from("organization_privacy_policies")
      .upsert(
        {
          organization_id: input.organizationId,
          audio_retention_days: input.audioRetentionDays,
          transcript_retention_days: input.transcriptRetentionDays,
          consent_required: input.consentRequired,
          permitted_regions: input.permittedRegions,
          redact_diagnostics: input.redactDiagnostics,
          updated_by: input.updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      )
      .select("organization_id,audio_retention_days,transcript_retention_days,consent_required,permitted_regions,redact_diagnostics,updated_by,updated_at")
      .single();
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return privacyPolicySchema.parse(data);
  }

  // ── Quotas ────────────────────────────────────────────────────────────────
  async listQuotas(organizationId: string): Promise<ProviderQuota[]> {
    const { data, error } = await this.db
      .from("organization_provider_quotas")
      .select("organization_id,provider,max_session_estimated_cost,max_organization_estimated_cost,max_concurrent_sessions,updated_by,updated_at")
      .eq("organization_id", organizationId)
      .order("provider");
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return z.array(providerQuotaSchema).parse(data ?? []);
  }

  async upsertQuota(input: {
    organizationId: string;
    provider: Provider;
    maxSessionEstimatedCost: number;
    maxOrganizationEstimatedCost: number;
    maxConcurrentSessions: number;
    updatedBy: string;
  }): Promise<ProviderQuota> {
    const { data, error } = await this.db
      .from("organization_provider_quotas")
      .upsert(
        {
          organization_id: input.organizationId,
          provider: input.provider,
          max_session_estimated_cost: input.maxSessionEstimatedCost,
          max_organization_estimated_cost: input.maxOrganizationEstimatedCost,
          max_concurrent_sessions: input.maxConcurrentSessions,
          updated_by: input.updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,provider" },
      )
      .select("organization_id,provider,max_session_estimated_cost,max_organization_estimated_cost,max_concurrent_sessions,updated_by,updated_at")
      .single();
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return providerQuotaSchema.parse(data);
  }

  // ── Usage ─────────────────────────────────────────────────────────────────
  /** Admin-gated security-definer read RPC; raw usage tables remain unavailable to clients. */
  async getUsageSummary(
    organizationId: string,
    periodStart?: string,
  ): Promise<UsageSummary[]> {
    const args: Record<string, unknown> = { p_organization_id: organizationId };
    if (periodStart) args.p_period_start = periodStart;
    const { data, error } = await this.db.rpc("get_usage_summary", args);
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return z.array(usageSummarySchema).parse(data ?? []);
  }

  /** Idempotent usage event recording via service-role RPC. */
  async recordUsage(input: UsageRecord): Promise<boolean> {
    const parsed = z.object({
      eventId: z.string().uuid(),
      organizationId: z.string().uuid(),
      agentId: z.string().uuid(),
      provider,
      sessionId: z.string().uuid(),
      metric: z.enum(["stt_seconds", "llm_input_tokens", "llm_output_tokens", "tts_characters"]),
      quantity: z.number().nonnegative(),
      estimatedCost: z.number().nonnegative(),
    }).safeParse(input);
    if (!parsed.success) throw new GovernanceValidationError("Provider usage record is invalid");
    const v = parsed.data;
    const { data, error } = await this.db.rpc("record_provider_usage", {
      p_event_id: v.eventId,
      p_organization_id: v.organizationId,
      p_agent_id: v.agentId,
      p_provider: v.provider,
      p_session_id: v.sessionId,
      p_metric: v.metric,
      p_quantity: v.quantity,
      p_estimated_cost: v.estimatedCost,
    });
    if (error) throw new GovernancePolicyUnavailable(error.message);
    if (typeof data !== "boolean") throw new GovernancePolicyUnavailable("Provider usage record failed");
    return data;
  }

  /** Concurrent-session reservation via service-role RPC. */
  async reserveSession(input: {
    organizationId: string;
    agentId: string;
    provider: Provider;
    sessionId: string;
    expiresAt: string;
  }): Promise<boolean> {
    const { data, error } = await this.db.rpc("reserve_provider_session", {
      p_organization_id: input.organizationId,
      p_agent_id: input.agentId,
      p_provider: input.provider,
      p_session_id: input.sessionId,
      p_expires_at: input.expiresAt,
    });
    if (error) throw new GovernancePolicyUnavailable(error.message);
    if (typeof data !== "boolean") throw new GovernancePolicyUnavailable("Provider session reservation failed");
    return data;
  }

  // ── Audit events (immutable read) ─────────────────────────────────────────
  async getAuditEvents(organizationId: string, limit = 50): Promise<AuditEvent[]> {
    const { data, error } = await this.db.rpc("get_audit_events", {
      p_organization_id: organizationId,
      p_limit: Math.min(limit, 200),
    });
    if (error) throw new GovernancePolicyUnavailable(error.message);
    return z.array(auditEventSchema).parse(data ?? []);
  }
}
