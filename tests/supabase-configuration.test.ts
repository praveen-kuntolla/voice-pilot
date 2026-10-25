import { describe, expect, it } from "vitest";
import { isLoopbackSupabaseUrl, supabaseConfigurationError } from "@/lib/env";

const configured = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-test",
};

describe("Supabase public configuration", () => {
  it("accepts loopback URLs for local development", () => {
    expect(isLoopbackSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLoopbackSupabaseUrl("https://localhost:54321")).toBe(true);
    expect(supabaseConfigurationError(configured, "development")).toBeNull();
  });

  it("rejects a remote project URL during local development", () => {
    expect(supabaseConfigurationError({ ...configured, NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }, "development"))
      .toMatch(/loopback Supabase URL/);
  });

  it("requires both public Supabase settings", () => {
    expect(supabaseConfigurationError({ NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }, "development"))
      .toMatch(/not configured/);
  });

  it("allows a deployment URL in production", () => {
    expect(supabaseConfigurationError({ ...configured, NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }, "production")).toBeNull();
  });
});
