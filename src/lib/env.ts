import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
});

type SupabasePublicConfiguration = Pick<typeof env, "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY">;

export function isLoopbackSupabaseUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1");
  } catch {
    return false;
  }
}

export function supabaseConfigurationError(
  values: SupabasePublicConfiguration = env,
  runtime = process.env.NODE_ENV,
) {
  if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return "Supabase is not configured. Set the public Supabase URL and publishable key.";
  }

  if (runtime === "development" && !isLoopbackSupabaseUrl(values.NEXT_PUBLIC_SUPABASE_URL)) {
    return "Local development requires a loopback Supabase URL. Configure the isolated local Supabase stack before signing in.";
  }

  return null;
}

export function assertSupabaseConfigured() {
  const error = supabaseConfigurationError();
  if (error) throw new Error(error);
}

export const isSupabaseConfigured = !supabaseConfigurationError();
