import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
const schema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(254), message: z.string().trim().min(10).max(5000), website: z.string().max(0).optional() });
export async function POST(request: Request) {
  const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
  if(!rateLimit(`contact:${ip}`,5,60_000)) return NextResponse.json({error:"Too many requests. Try again later."},{status:429});
  if (!isSupabaseConfigured) return NextResponse.json({ error: "Contact persistence is not configured." }, { status: 503 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
  const { website, ...submission } = parsed.data; void website;
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.from("contact_submissions").insert(submission);
  if (error) return NextResponse.json({ error: "Unable to save submission." }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
