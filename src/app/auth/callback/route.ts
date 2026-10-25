import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNext(value: string | null) { return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard"; }
export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=callback", url.origin));
  }
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url.origin));
}
