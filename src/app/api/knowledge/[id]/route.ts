import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { knowledgeSourceSchema } from "@/lib/schemas";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { s, user, membership } = await currentMembership();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!membership || !canWrite(membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const incoming = await request.json().catch(() => null);
  const current = await s.from("knowledge_sources").select("title,source_type,source_uri").eq("id", id).eq("organization_id", membership.organization_id).maybeSingle();
  if (current.error) return NextResponse.json({ error: "Unable to read knowledge source." }, { status: 503 });
  if (!current.data) return NextResponse.json({ error: "Knowledge source not found." }, { status: 404 });
  const parsed = knowledgeSourceSchema.safeParse({ ...current.data, ...(incoming && typeof incoming === "object" ? incoming : {}) });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid knowledge source" }, { status: 400 });
  const { data, error } = await s.from("knowledge_sources").update(parsed.data).eq("id", id).eq("organization_id", membership.organization_id).select().single();
  return error ? NextResponse.json({ error: "Unable to update knowledge source." }, { status: 503 }) : NextResponse.json({ source: data });
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  const { s, user, membership } = await currentMembership();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!membership || !canWrite(membership.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { error } = await s.from("knowledge_sources").delete().eq("id", id).eq("organization_id", membership.organization_id);
  return error ? NextResponse.json({ error: "Unable to delete knowledge source." }, { status: 503 }) : NextResponse.json({ ok: true });
}
