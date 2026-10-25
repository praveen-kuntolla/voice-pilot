import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service role key.
 * Used exclusively for governance RPCs that need to bypass RLS
 * (reserve_provider_session, record_provider_usage, get_usage_summary, get_audit_events).
 * Never expose this client or its credentials to the browser.
 */
export function createGovernanceServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Governance database credentials are unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
