import type { SafetyQuery } from "@/lib/postgres-durable-safety";
import type { AuthoritativePolicyContext, PolicyContextRepository } from "@/lib/policy-enforcement-gateway";

if (typeof window !== "undefined") throw new Error("PostgreSQL policy repository is server-only");

type PolicyRow = {
  organization_id: string; campaign_id: string; campaign_status: string; campaign_agent_id: string; consent_required: boolean;
  timezone: string; start_hour: number; end_hour: number; contact_id: string; contact_name: string; consent_status: "unknown" | "granted" | "revoked"; opted_out_at: string | null;
  agent_id: string; agent_status: string; provider: string; max_attempts: number; estimated_action_cents: string | number;
  max_concurrent: number; max_per_minute: number; current_concurrent: string | number; budget_cents: string | number; used_cents: string | number; reserved_cents: string | number;
};

const safeInteger = (value: string | number) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null; };

export class PostgresPolicyRepository implements PolicyContextRepository {
  constructor(private readonly query: SafetyQuery) {}

  async load(input: { organizationId: string; campaignId: string; agentId: string; contactId: string }): Promise<AuthoritativePolicyContext | null> {
    const result = await this.query<PolicyRow>(`select c.organization_id,c.id campaign_id,c.status campaign_status,c.agent_id campaign_agent_id,c.consent_required,c.timezone,c.start_hour,c.end_hour,
      ct.id contact_id,ct.name contact_name,ct.consent_status,ct.opted_out_at,a.id agent_id,a.status agent_status,p.provider,p.max_attempts,p.estimated_action_cents,
      l.max_concurrent,l.max_per_minute,(select count(*) from public.provider_action_reservations r where r.organization_id=c.organization_id and r.provider=p.provider and r.status='active' and r.expires_at>clock_timestamp()) current_concurrent,
      u.budget_cents,u.used_cents,u.reserved_cents
      from public.campaigns c join public.agents a on a.id=c.agent_id and a.organization_id=c.organization_id
      join public.contacts ct on ct.id=$4::uuid and ct.organization_id=c.organization_id
      join voicepilot_safety.provider_action_policies p on p.organization_id=c.organization_id and p.campaign_id=c.id and p.agent_id=a.id and p.enabled=true
      join voicepilot_safety.provider_limits l on l.organization_id=c.organization_id and l.provider=p.provider
      join voicepilot_safety.provider_usage_accounts u on u.organization_id=c.organization_id
      join public.organization_provider_quotas q on q.organization_id=c.organization_id and q.provider=p.provider and q.max_concurrent_sessions=l.max_concurrent
      join public.organization_provider_approvals opa on opa.organization_id=c.organization_id and opa.provider=p.provider and opa.revoked_at is null
      join public.agent_provider_approvals apa on apa.organization_id=c.organization_id and apa.agent_id=a.id and apa.provider=p.provider and apa.revoked_at is null
      where c.organization_id=$1::uuid and c.id=$2::uuid and a.id=$3::uuid and c.status in ('draft','test')
      and exists(select 1 from public.organization_members m where m.organization_id=c.organization_id and m.user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid and m.role in ('owner','admin'))`, [input.organizationId, input.campaignId, input.agentId, input.contactId]);
    const row = result.rows[0]; if (!row) return null;
    const estimated = safeInteger(row.estimated_action_cents), concurrent = safeInteger(row.current_concurrent), budget = safeInteger(row.budget_cents), used = safeInteger(row.used_cents), reserved = safeInteger(row.reserved_cents);
    if (estimated === null || concurrent === null || budget === null || used === null || reserved === null || used > Number.MAX_SAFE_INTEGER - reserved) return null;
    return {
      organizationId: row.organization_id,
      campaign: { id: row.campaign_id, organization_id: row.organization_id, agent_id: row.campaign_agent_id, status: row.campaign_status, consent_required: row.consent_required },
      contact: { id: row.contact_id, name: row.contact_name, organization_id: row.organization_id, consent_status: row.consent_status, opted_out_at: row.opted_out_at },
      agent: { id: row.agent_id, organization_id: row.organization_id, enabled: row.agent_status !== "archived" }, provider: row.provider,
      limits: { maxConcurrent: row.max_concurrent, currentConcurrent: concurrent, maxAttempts: row.max_attempts, attempt: 0, maxSpendCents: budget, spentCents: used + reserved, emergencyStop: false },
      callingHours: { timeZone: row.timezone, startHour: row.start_hour, endHour: row.end_hour }, maxPerMinute: row.max_per_minute, estimatedCostCents: estimated,
    };
  }

  async claimRateLimit(input: { organizationId: string; provider: string; limit: number }) {
    return (await this.query<{ result: boolean }>("select voicepilot_safety.claim_rate($1::uuid,$2::text,$3::integer) result", [input.organizationId, input.provider, input.limit])).rows[0]?.result === true;
  }
}
