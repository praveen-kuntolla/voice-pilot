import type { SafetyQuery } from "@/lib/postgres-durable-safety";
if (typeof window !== "undefined") throw new Error("Operational maintenance is server-only");
export type CleanupReport={replay:number;actions:number;rateWindows:number;usage:number;retriesReconciled:number;retriesRemoved:number;backlogAgeSeconds:number};
export class OperationalMaintenanceRunner{
  constructor(private readonly query:SafetyQuery,private readonly databaseName:string){if(!/^vp_operational_[a-z0-9_]+$/i.test(databaseName))throw new Error("Refusing non-disposable maintenance target");}
  async run(input:{organizationId:string;before:number;retentionBefore:number;batchSize:number}):Promise<CleanupReport>{
    if(!/^[0-9a-f-]{36}$/i.test(input.organizationId)||!Number.isSafeInteger(input.before)||!Number.isSafeInteger(input.retentionBefore)||input.retentionBefore>input.before||!Number.isSafeInteger(input.batchSize)||input.batchSize<1||input.batchSize>1000)throw new Error("invalid_maintenance_request");
    const before=new Date(input.before).toISOString(),retention=new Date(input.retentionBefore).toISOString(),limit=input.batchSize;
    const scalar=async(sql:string,values:readonly unknown[])=>Number((await this.query<{result:number}>(sql,values)).rows[0]?.result??0);
    const replay=await scalar("select voicepilot_safety.cleanup_replay($1::timestamptz,$2::integer) result",[before,limit]);
    const actions=await scalar("select voicepilot_safety.cleanup_action_reservations($1::timestamptz,$2::integer) result",[retention,limit]);
    const rateWindows=await scalar("select voicepilot_safety.cleanup_rate_windows($1::timestamptz,$2::integer) result",[before,limit]);
    const usage=await scalar("select voicepilot_safety.expire_usage($1::uuid,$2::integer) result",[input.organizationId,limit]);
    const retriesReconciled=await scalar("select voicepilot_safety.reconcile_retry_attempts($1::timestamptz,$2::integer) result",[before,limit]);
    const retriesRemoved=await scalar("select voicepilot_safety.cleanup_retry_attempts($1::timestamptz,$2::integer) result",[retention,limit]);
    const backlog=(await this.query<{age_seconds:string|number|null}>("select greatest(0,extract(epoch from clock_timestamp()-min(expires_at))) age_seconds from voicepilot_safety.provider_retry_attempts where state='reserved' and expires_at<=clock_timestamp()",[])).rows[0]?.age_seconds;
    const backlogAgeSeconds=backlog==null?0:Math.max(0,Math.floor(Number(backlog)));
    if(![replay,actions,rateWindows,usage,retriesReconciled,retriesRemoved,backlogAgeSeconds].every(Number.isSafeInteger))throw new Error("maintenance_result_unavailable");
    return{replay,actions,rateWindows,usage,retriesReconciled,retriesRemoved,backlogAgeSeconds};
  }
}
