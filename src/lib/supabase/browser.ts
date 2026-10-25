import { createBrowserClient } from "@supabase/ssr";
import { assertSupabaseConfigured, env } from "@/lib/env";

export function createSupabaseBrowserClient() {
  assertSupabaseConfigured();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
