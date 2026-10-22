import {NextResponse} from "next/server";
import {currentMembership} from "@/lib/authz";
import {createLiveKitToken,getLiveKitConfiguration,voiceRoomName} from "@/lib/livekit";
import {registerIssuedRoom} from "@/lib/livekit-room-auth";
import {randomUUID} from "node:crypto";
import {z} from "zod";

const schema = z.object({agent_id:z.string().uuid()}).strict();

export async function POST(req: Request) {
  const {s,user,membership} = await currentMembership();
  if (!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  if (!membership) return NextResponse.json({error:"Organization required"},{status:403});
  let config: ReturnType<typeof getLiveKitConfiguration>;
  try { config = getLiveKitConfiguration(); }
  catch { return NextResponse.json({error:"LiveKit is disabled or not configured"},{status:503}); }
  const parsed = schema.safeParse(await req.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:"Invalid agent"},{status:400});
  const {data,error} = await s.from("agents").select("id").eq("id",parsed.data.agent_id).eq("organization_id",membership.organization_id).maybeSingle();
  if (error) return NextResponse.json({error:"Agent lookup unavailable"},{status:503});
  if (!data) return NextResponse.json({error:"Agent not found"},{status:404});
  try {
    const sessionId=randomUUID();
    const room = voiceRoomName(membership.organization_id,data.id,sessionId);
    const token = await createLiveKitToken({identity:user.id,room},config);
    if(!await registerIssuedRoom(room,membership.organization_id,data.id,user.id,sessionId))throw new Error("Room authorization unavailable");
    return NextResponse.json({token,room,url:config.url,mode:config.mode},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"LiveKit token unavailable"},{status:503});
  }
}
