import "server-only";
import {createClient} from "@supabase/supabase-js";

export function createWorkerDatabaseClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Worker database credentials are unavailable");
  if (process.env.VOICE_CONNECTIVITY_TEST_ENABLED === "true") {
    const host=new URL(url).hostname;
    if (host!=="127.0.0.1" && host!=="localhost") throw new Error("Connectivity mode requires local Supabase");
  }
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
