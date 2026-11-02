import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { knowledgeSourceSchema } from "@/lib/schemas";

export async function GET() {
  const { s, user, membership } = await currentMembership();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!membership) return NextResponse.json({ sources: [] });
  const { data, error } = await s.from("knowledge_sources").select("id,title,source_type,source_uri,status,organization_id,created_by,created_at").eq("organization_id", membership.organization_id).order("created_at", { ascending: false });
  return error ? NextResponse.json({ error: "Knowledge base is unavailable." }, { status: 503 }) : NextResponse.json({ sources: data ?? [] });
}

export async function POST(request: Request) {
  const { s, user, membership } = await currentMembership();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!membership || !canWrite(membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = knowledgeSourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid knowledge source" }, { status: 400 });
  const { data, error } = await s.from("knowledge_sources").insert({ ...parsed.data, organization_id: membership.organization_id, created_by: user.id, status: "ready" }).select().single();
  return error ? NextResponse.json({ error: "Knowledge source persistence is unavailable." }, { status: 503 }) : NextResponse.json({ source: data }, { status: 201 });
}
