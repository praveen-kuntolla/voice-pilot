import { NextResponse } from "next/server";
import { currentMembership } from "@/lib/authz";
import { createLiveKitToken, getLiveKitConfiguration, voiceRoomName } from "@/lib/livekit";
import { registerIssuedRoom } from "@/lib/livekit-room-auth";
import { browserVoiceSessionRequestSchema, isBrowserVoiceActivationEnabled } from "@/lib/browser-voice-session";
import { isDurableBrowserAdmissionWired } from "@/lib/durable-browser-admission";
import { randomUUID } from "node:crypto";

/** Future browser voice path. It is server-gated and disabled by default. */
export async function POST(req: Request) {
  let context: Awaited<ReturnType<typeof currentMembership>>;
  try { context = await currentMembership(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { s, user, membership } = context;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!membership) return NextResponse.json({ error: "Organization required" }, { status: 403 });
  if (!isBrowserVoiceActivationEnabled()) return NextResponse.json({ error: "Browser voice activation is disabled" }, { status: 503 });
  if (!isDurableBrowserAdmissionWired()) return NextResponse.json({ error: "Durable voice admission is unavailable" }, { status: 503 });
  const parsed = browserVoiceSessionRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Explicit microphone consent and a valid agent are required" }, { status: 400 });
  const { data, error } = await s.from("agents").select("id").eq("id", parsed.data.agent_id).eq("organization_id", membership.organization_id).maybeSingle();
  if (error) return NextResponse.json({ error: "Agent lookup unavailable" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  try {
    const config = getLiveKitConfiguration();
    const sessionId = randomUUID();
    const room = voiceRoomName(membership.organization_id, data.id, sessionId);
    const token = await createLiveKitToken({ identity: user.id, room }, config);
    if (!await registerIssuedRoom(room, membership.organization_id, data.id, user.id, sessionId)) throw new Error("Room authorization unavailable");
    return NextResponse.json({ token, room, url: config.url, sessionId }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Browser voice session unavailable" }, { status: 503 }); }
}
