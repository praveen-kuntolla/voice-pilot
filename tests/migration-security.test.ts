import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Migration 005 ─────────────────────────────────────────────────────────────
const sql005 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220005_security_reconciliation.sql"),
  "utf8",
);
describe("migration 005 security invariants", () => {
  it("does not contain destructive table operations", () => {
    expect(sql005).not.toMatch(/drop\s+(table|schema|database)|truncate\s+/i);
  });
  it("binds campaign agents to their organization", () => {
    expect(sql005).toContain("campaign agent must belong to the same organization");
    expect(sql005).toContain("campaigns_agent_same_org");
  });
  it("removes member invitation reads and blocks owner invitations", () => {
    expect(sql005).toContain('drop policy if exists "members read invitations"');
    expect(sql005).toMatch(/role\s*<>\s*'owner'/);
  });
  it("uses explicit role policies", () => {
    expect(sql005).toContain('create policy "agents_insert_admin"');
    expect(sql005).toContain('create policy "campaigns_delete_admin"');
  });
});

// ── Migration 007 ─────────────────────────────────────────────────────────────
const sql007 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220007_provider_governance.sql"),
  "utf8",
);
describe("migration 007 provider governance invariants", () => {
  it("enables RLS on all nine governance tables", () => {
    const tables = [
      "organization_provider_approvals",
      "agent_provider_approvals",
      "organization_privacy_policies",
      "organization_provider_quotas",
      "provider_session_reservations",
      "provider_session_usage",
      "organization_usage_summaries",
      "provider_usage_events",
      "provider_audit_events",
    ];
    for (const table of tables) {
      expect(sql007).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("restricts every governance policy to is_org_admin", () => {
    expect(sql007).toContain("public.is_org_admin(organization_id)");
    // All admin-facing policies reference the admin helper
    const policyCount = (sql007.match(/create policy /g) ?? []).length;
    expect(policyCount).toBeGreaterThanOrEqual(9);
  });

  it("never exposes usage/reservation tables to client writes", () => {
    // No INSERT/UPDATE/DELETE policies on internal-only tables
    const internalTables = ["provider_session_reservations", "provider_session_usage", "organization_usage_summaries", "provider_usage_events"];
    for (const table of internalTables) {
      // RLS should be enabled but no client-accessible write policy
      expect(sql007).toContain(`alter table public.${table} enable row level security`);
      expect(sql007).not.toMatch(new RegExp(`create policy .* on public\\.${table} for insert`));
      expect(sql007).not.toMatch(new RegExp(`create policy .* on public\\.${table} for update`));
    }
  });

  it("credential field check blocks sensitive data in audit metadata", () => {
    expect(sql007).toContain("not (metadata ? 'credential')");
    expect(sql007).toContain("not (metadata ? 'transcript')");
    expect(sql007).toContain("not (metadata ? 'audio')");
  });

  it("validates agent belongs to organization on governance writes", () => {
    expect(sql007).toContain("provider governance agent must belong to organization");
  });

  it("reserves and records usage only through service-role RPCs", () => {
    expect(sql007).toContain("grant execute on function public.reserve_provider_session");
    expect(sql007).toContain("grant execute on function public.record_provider_usage");
    expect(sql007).toContain("to service_role");
    // Neither function is granted to authenticated or public
    expect(sql007).not.toMatch(/grant execute on function public\.reserve_provider_session.*to\s+(authenticated|public)/);
    expect(sql007).not.toMatch(/grant execute on function public\.record_provider_usage.*to\s+(authenticated|public)/);
  });

  it("uses advisory lock for atomic concurrent-session enforcement", () => {
    expect(sql007).toContain("pg_advisory_xact_lock");
  });

  it("enforces idempotent usage via event_id deduplication", () => {
    expect(sql007).toContain("exists(select 1 from public.provider_usage_events where event_id=p_event_id)");
  });
});

// ── Migration 008 ─────────────────────────────────────────────────────────────
const sql008 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220008_governance_hardening.sql"),
  "utf8",
);
describe("migration 008 governance hardening invariants", () => {
  it("is fully additive — no destructive drops of tables or data", () => {
    // drop trigger is ok; drop table/schema is not
    expect(sql008).not.toMatch(/drop\s+(table|schema|database|view|column)\s+(?!if\s+exists)/i);
    expect(sql008).not.toMatch(/truncate\s+/i);
  });

  it("uses CREATE INDEX IF NOT EXISTS for all new indexes", () => {
    const indexMatches = sql008.match(/create index\s+(if not exists\s+)?\w+/gi) ?? [];
    for (const m of indexMatches) {
      expect(m.toLowerCase()).toContain("if not exists");
    }
  });

  it("re-creates is_org_admin with CREATE OR REPLACE for idempotency", () => {
    expect(sql008).toContain("create or replace function public.is_org_admin");
  });

  it("adds touch_updated_at trigger function", () => {
    expect(sql008).toContain("create or replace function public.touch_updated_at");
    expect(sql008).toContain("new.updated_at = now()");
  });

  it("adds updated_at triggers for all mutable governance tables", () => {
    const tables = [
      "org_provider_approvals_updated_at",
      "agent_provider_approvals_updated_at",
      "org_privacy_policies_updated_at",
      "org_provider_quotas_updated_at",
    ];
    for (const trigger of tables) {
      expect(sql008).toContain(trigger);
    }
  });

  it("revoke_provider_approval RPC enforces is_org_admin before mutating", () => {
    expect(sql008).toContain("create or replace function public.revoke_provider_approval");
    expect(sql008).toContain("if not public.is_org_admin(p_organization_id) then raise exception 'admin required'");
  });

  it("admin-gated read helper is not granted to public", () => {
    expect(sql008).toContain("grant execute on function public.get_usage_summary");
    expect(sql008).toContain("to authenticated");
    // get_usage_summary must not be granted to public
    expect(sql008).not.toMatch(/grant execute on function public\.get_usage_summary.*to\s+public/);
  });

  it("independently authorizes both security-definer read helpers", () => {
    expect(sql008).toMatch(/get_usage_summary[\s\S]*public\.is_org_admin\(p_organization_id\)/);
    expect(sql008).toMatch(/get_audit_events[\s\S]*public\.is_org_admin\(p_organization_id\)/);
  });

  it("revoke_provider_approval is granted to authenticated (uses is_org_admin for authz)", () => {
    expect(sql008).toContain("grant execute on function public.revoke_provider_approval");
    expect(sql008).toContain("to authenticated");
  });
});

// ── Migration 009 ─────────────────────────────────────────────────────────────
const sql009 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220009_provider_governance_security_fixes.sql"),
  "utf8",
);
describe("migration 009 governance security repairs", () => {
  it("handles audit targets without assuming every row has revoked_at", () => {
    expect(sql009).toContain("when 'organization_provider_quotas'");
    expect(sql009).toContain("v_action := 'quota_changed'");
    expect(sql009).toContain("old.revoked_at is distinct from new.revoked_at");
  });

  it("uses a hardened security-definer search path", () => {
    expect(sql009).toContain("security definer set search_path=pg_catalog, public");
  });

  it("explicitly restricts accounting RPCs to service_role", () => {
    for (const fn of ["reserve_provider_session", "record_provider_usage"]) {
      expect(sql009).toMatch(new RegExp(`revoke all on function public\\.${fn}.*from public, anon, authenticated, service_role`));
      expect(sql009).toMatch(new RegExp(`grant execute on function public\\.${fn}.*to service_role`));
    }
  });

  it("preserves authenticated-only invitation acceptance and trigger-only validation", () => {
    expect(sql009).toMatch(/grant execute on function public\.accept_organization_invitation\(text\) to authenticated/);
    expect(sql009).toMatch(/revoke all on function public\.validate_campaign_agent_organization\(\) from public, anon, authenticated, service_role/);
  });
});

// ── Migration 010 ─────────────────────────────────────────────────────────────
const sql010 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220010_provider_governance_audit_actions.sql"),
  "utf8",
);
describe("migration 010 audit-action invariants", () => {
  it("extends the action check with approval_updated while preserving prior actions", () => {
    expect(sql010).toContain("'approval_updated'");
    for (const action of ["approval_granted", "approval_revoked", "credential_reference_changed", "quota_changed"]) {
      expect(sql010).toContain(`'${action}'`);
    }
  });

  it("maps credential changes and ordinary updates to distinct audit actions", () => {
    expect(sql010).toContain("old.credential_reference is distinct from new.credential_reference");
    expect(sql010).toContain("v_action := 'credential_reference_changed'");
    expect(sql010).toContain("v_action := 'approval_updated'");
  });

  it("keeps security-definer safeguards and fails unsupported trigger operations", () => {
    expect(sql010).toContain("security definer set search_path=pg_catalog, public");
    expect(sql010).toContain("unsupported governance audit operation");
  });
});

// ── Migration 011 ─────────────────────────────────────────────────────────────
const sql011 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220011_agent_approval_audit_trigger_fix.sql"),
  "utf8",
);

describe("migration 011 agent approval audit repair", () => {
  const agentBranch = sql011.split("when 'agent_provider_approvals' then")[1]
    .split("when 'organization_privacy_policies' then")[0];
  const organizationBranch = sql011.split("when 'organization_provider_approvals' then")[1]
    .split("when 'agent_provider_approvals' then")[0];

  it("does not read credential_reference from agent approval records", () => {
    expect(agentBranch).not.toContain("credential_reference");
    expect(organizationBranch).toContain("old.credential_reference is distinct from new.credential_reference");
  });

  it("maps creation, revocation, restoration, and meaningful agent updates safely", () => {
    expect(agentBranch).toContain("tg_op = 'INSERT'");
    expect(agentBranch).toContain("v_action := 'approval_granted'");
    expect(agentBranch).toContain("else 'approval_revoked' end");
    expect(agentBranch).toContain("v_action := 'approval_updated'");
    expect(agentBranch).toContain("old.revoked_at is distinct from new.revoked_at");
  });

  it("makes unchanged active approval upserts audit-idempotent", () => {
    expect(agentBranch).toContain("old.approved_by is not distinct from new.approved_by");
    expect(agentBranch).toContain("return new;");
    expect(agentBranch).toContain("old.organization_id is not distinct from new.organization_id");
    expect(agentBranch).toContain("old.agent_id is not distinct from new.agent_id");
  });

  it("retains the hardened security-definer boundary and no execute grants", () => {
    expect(sql011).toContain("security definer");
    expect(sql011).toContain("set search_path=pg_catalog, public");
    expect(sql011).toContain("revoke all on function public.audit_provider_governance() from public, anon, authenticated, service_role");
    expect(sql011).not.toMatch(/grant execute on function public\.audit_provider_governance/i);
  });
});

// ── Migrations 012–013 (review-only) ─────────────────────────────────────────
const sql012 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220012_durable_safety_foundations.sql"),
  "utf8",
);
const sql013 = readFileSync(
  path.join(process.cwd(), "supabase/migrations/202610220013_transactional_safety.sql"),
  "utf8",
);
const sql015 = readFileSync(path.join(process.cwd(),"supabase/migrations/202610220015_operational_safety.sql"),"utf8").toLowerCase();
const sql016 = readFileSync(path.join(process.cwd(),"supabase/migrations/202610220016_retry_audit_hardening.sql"),"utf8").toLowerCase();

describe("review-only transactional safety migrations", () => {
  it("keeps all durable tables protected by RLS and without client policies", () => {
    for (const table of ["provider_replay_claims", "provider_safety_controls", "provider_action_reservations", "provider_usage_ledger"]) {
      expect(sql012).toContain(`alter table public.${table} enable row level security`);
      expect(sql012).not.toMatch(new RegExp(`create policy .* on public\\.${table}`, "i"));
    }
  });

  it("binds privileged actor claims to the trusted request context", () => {
    expect(sql013).toContain("current_setting('request.jwt.claim.sub',true)");
    expect(sql013.match(/current_actor\(\) is distinct from p_actor/g)).toHaveLength(4);
  });

  it("serializes global and organization stop updates against safety checks", () => {
    expect(sql013).toContain("pg_advisory_xact_lock_shared(hashtextextended('voicepilot:global-stop',0))");
    expect(sql013).toContain("pg_advisory_xact_lock(hashtextextended('voicepilot:global-stop',0))");
    expect(sql013).toContain("pg_advisory_xact_lock_shared(hashtextextended('voicepilot:organization-stop:' || p_org::text,0))");
    expect(sql013).toContain("pg_advisory_xact_lock(hashtextextended('voicepilot:organization-stop:' || p_org::text,0))");
  });

  it("keeps privileged routines off PUBLIC and client roles with a fixed search path", () => {
    expect(sql013).toContain("revoke all on all functions in schema voicepilot_safety from public, anon, authenticated");
    expect(sql013).toContain("set search_path = pg_catalog");
    expect(sql013).not.toMatch(/grant execute on all functions in schema voicepilot_safety to (public|anon|authenticated)/i);
  });
});

describe("review-only operational safety migration",()=>{
  it("keeps retry and audit objects private and service-routine only",()=>{expect(sql015).toContain("revoke all on voicepilot_safety.provider_retry_attempts from public,anon,authenticated");expect(sql015).toContain("revoke all on voicepilot_safety.gateway_audit_events from public,anon,authenticated");expect(sql015).toContain("revoke all on all functions in schema voicepilot_safety from public,anon,authenticated");expect(sql015).not.toMatch(/grant execute on all functions in schema voicepilot_safety to (public|anon|authenticated)/);});
  it("uses bounded skip-locked reconciliation and immutable audit rows",()=>{expect(sql015).toContain("limit p_limit for update skip locked");expect(sql015).toContain("gateway audit events are immutable");expect(sql015).toContain("pg_advisory_xact_lock");});
});
describe("review-only retry hardening migration",()=>{
  it("retains immutable retry ledger and monotonic counters",()=>{expect(sql016).toContain("provider_retry_ledger");expect(sql016).toContain("provider_retry_counters");expect(sql016).toContain("primary key (organization_id,idempotency_key)");expect(sql016).toContain("last_attempt_number");expect(sql016).toContain("pg_advisory_xact_lock");});
  it("keeps safety tables private and maintenance scope explicit",()=>{expect(sql016).toContain("revoke all on voicepilot_safety.provider_retry_ledger,voicepilot_safety.provider_retry_counters from public,anon,authenticated");expect(sql016).toContain("trusted global maintenance");expect(sql016).toContain("review only");});
});
