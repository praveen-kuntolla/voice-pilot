import "server-only";
import {z} from "zod";

const provider=z.enum(["deepgram","openai","elevenlabs"]);
export const providerApprovalSchema=z.object({organization_id:z.string().uuid(),provider,credential_reference:z.string().min(3).max(256),approved_by:z.string().uuid(),approved_at:z.string().datetime().optional(),revoked_at:z.string().datetime().nullable().optional()});
export const privacyPolicySchema=z.object({organization_id:z.string().uuid(),audio_retention_days:z.number().int().min(0).max(365),transcript_retention_days:z.number().int().min(0).max(365),consent_required:z.boolean(),permitted_regions:z.array(z.string().min(2).max(20)),redact_diagnostics:z.boolean()});
export const providerQuotaSchema=z.object({organization_id:z.string().uuid(),provider,max_session_estimated_cost:z.number().nonnegative(),max_organization_estimated_cost:z.number().nonnegative(),max_concurrent_sessions:z.number().int().nonnegative()});
export const providerPolicySnapshotSchema=z.object({organizationId:z.string().uuid(),agentId:z.string().uuid(),organizationApprovals:z.array(providerApprovalSchema),agentApprovals:z.array(z.object({organization_id:z.string().uuid(),agent_id:z.string().uuid(),provider,revoked_at:z.string().datetime().nullable().optional()})),privacy:privacyPolicySchema.nullable(),quotas:z.array(providerQuotaSchema)});
export type ProviderPolicySnapshot=z.infer<typeof providerPolicySnapshotSchema>;
export type UsageRecord={eventId:string;organizationId:string;agentId:string;provider:z.infer<typeof provider>;sessionId:string;metric:"stt_seconds"|"llm_input_tokens"|"llm_output_tokens"|"tts_characters";quantity:number;estimatedCost:number};

/** Minimal server-only client shape; callers must inject an authenticated internal client. */
type QueryResult={data:unknown;error:{message:string}|null};
export type GovernanceDb={from:(table:string)=>{select:(fields:string)=>{eq:(column:string,value:string)=>Promise<QueryResult>}};rpc:(name:string,args:Record<string,unknown>)=>Promise<QueryResult>};
export class GovernancePolicyUnavailable extends Error{}

export class ProviderGovernanceRepository {
  constructor(private readonly db:GovernanceDb){}
  async loadSnapshot(organizationId:string,agentId:string):Promise<ProviderPolicySnapshot>{
    const [organizationApprovals,agentApprovals,privacy,quotas]=await Promise.all([
      this.db.from("organization_provider_approvals").select("organization_id,provider,credential_reference,approved_by,approved_at,revoked_at").eq("organization_id",organizationId),
      this.db.from("agent_provider_approvals").select("organization_id,agent_id,provider,revoked_at").eq("agent_id",agentId),
      this.db.from("organization_privacy_policies").select("organization_id,audio_retention_days,transcript_retention_days,consent_required,permitted_regions,redact_diagnostics").eq("organization_id",organizationId),
      this.db.from("organization_provider_quotas").select("organization_id,provider,max_session_estimated_cost,max_organization_estimated_cost,max_concurrent_sessions").eq("organization_id",organizationId),
    ]);
    if([organizationApprovals,agentApprovals,privacy,quotas].some(result=>result.error))throw new GovernancePolicyUnavailable("Provider governance policy could not be loaded");
    const parsed=providerPolicySnapshotSchema.safeParse({organizationId,agentId,organizationApprovals:organizationApprovals.data??[],agentApprovals:agentApprovals.data??[],privacy:Array.isArray(privacy.data)?privacy.data[0]??null:null,quotas:quotas.data??[]});
    if(!parsed.success)throw new GovernancePolicyUnavailable("Provider governance policy is invalid");
    if(parsed.data.agentApprovals.some(approval=>approval.organization_id!==organizationId||approval.agent_id!==agentId))throw new GovernancePolicyUnavailable("Provider governance tenant mismatch");
    return parsed.data;
  }
  async reserveSession(input:{organizationId:string;agentId:string;provider:z.infer<typeof provider>;sessionId:string;expiresAt:string}):Promise<boolean>{
    const result=await this.db.rpc("reserve_provider_session",{p_organization_id:input.organizationId,p_agent_id:input.agentId,p_provider:input.provider,p_session_id:input.sessionId,p_expires_at:input.expiresAt});
    if(result.error||typeof result.data!=="boolean")throw new GovernancePolicyUnavailable("Provider session reservation failed");return result.data;
  }
  async recordUsage(input:UsageRecord):Promise<boolean>{
    const parsed=z.object({eventId:z.string().uuid(),organizationId:z.string().uuid(),agentId:z.string().uuid(),provider,sessionId:z.string().uuid(),metric:z.enum(["stt_seconds","llm_input_tokens","llm_output_tokens","tts_characters"]),quantity:z.number().nonnegative(),estimatedCost:z.number().nonnegative()}).safeParse(input);
    if(!parsed.success)throw new GovernancePolicyUnavailable("Provider usage record is invalid");
    const v=parsed.data;const result=await this.db.rpc("record_provider_usage",{p_event_id:v.eventId,p_organization_id:v.organizationId,p_agent_id:v.agentId,p_provider:v.provider,p_session_id:v.sessionId,p_metric:v.metric,p_quantity:v.quantity,p_estimated_cost:v.estimatedCost});
    if(result.error||typeof result.data!=="boolean")throw new GovernancePolicyUnavailable("Provider usage record failed");return result.data;
  }
}
