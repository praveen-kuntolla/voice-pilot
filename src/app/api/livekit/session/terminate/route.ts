import {NextResponse} from "next/server";
import {z} from "zod";
import {currentMembership} from "@/lib/authz";
import {parseVoiceRoomName} from "@/lib/livekit";
import {revokeIssuedRoom} from "@/lib/livekit-room-auth";

const schema=z.object({room_name:z.string().max(160)}).strict();

/** Revokes local authorization only; no LiveKit API call or remote room mutation. */
export async function POST(req:Request){
  if(!(req.headers.get("content-type")||"").toLowerCase().includes("application/json"))return NextResponse.json({error:"JSON required"},{status:415});
  const origin=req.headers.get("origin");
  if(origin&&origin!==new URL(req.url).origin)return NextResponse.json({error:"Invalid origin"},{status:403});
  const {user,membership}=await currentMembership();
  if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  if(!membership)return NextResponse.json({error:"Organization required"},{status:403});
  const parsed=schema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Invalid session"},{status:400});
  let room:ReturnType<typeof parseVoiceRoomName>;
  try{room=parseVoiceRoomName(parsed.data.room_name)}catch{return NextResponse.json({error:"Invalid session"},{status:400})}
  if(room.organizationId!==membership.organization_id)return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const revoked=await revokeIssuedRoom(parsed.data.room_name,room.organizationId,room.agentId,room.sessionId,user.id);
    if(!revoked)return NextResponse.json({error:"Session unavailable"},{status:404});
    return NextResponse.json({revoked:true,livekit_jwt_revoked:false},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"Security store unavailable"},{status:503})}
}
