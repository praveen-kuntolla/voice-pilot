import {NextResponse} from "next/server";
import {createWorkerDatabaseClient} from "@/lib/supabase/worker";
import {verifyWorkerRequest} from "@/lib/worker-auth";
import {consumeIssuedRoom} from "@/lib/livekit-room-auth";
import {parseVoiceRoomName} from "@/lib/livekit";
import {getVoiceSecurityStore} from "@/lib/voice-security-store";
import {z} from "zod";

const schema=z.object({organization_id:z.string().uuid(),agent_id:z.string().uuid(),room_name:z.string().max(160)}).strict();
const MAX_BODY=4096;
const path="/api/internal/voice-agent/config";

export async function POST(req:Request){
  if(process.env.VOICE_WORKER_ENABLED!=="true")return NextResponse.json({error:"Worker integration is disabled"},{status:503});
  const store=await getVoiceSecurityStore();
  if(!store)return NextResponse.json({error:"Replay/rate-limit protection unavailable"},{status:503});
  const body=await req.text();
  if(Buffer.byteLength(body,"utf8")>MAX_BODY)return NextResponse.json({error:"Request too large"},{status:413});
  const nonce=req.headers.get("x-voice-worker-nonce")||"";
  if(!await verifyWorkerRequest("POST",path,body,req.headers.get("x-voice-worker-timestamp")||"",nonce,req.headers.get("x-voice-worker-signature")||"",process.env.VOICE_WORKER_SHARED_SECRET||"",Date.now(),store))return NextResponse.json({error:"Unauthorized"},{status:401});
  try{if(!await store.allowRate("worker-config",60,60000))return NextResponse.json({error:"Rate limit exceeded"},{status:429})}catch{return NextResponse.json({error:"Security store unavailable"},{status:503})}
  let raw:unknown;try{raw=JSON.parse(body)}catch{return NextResponse.json({error:"Invalid JSON"},{status:400})}
  const parsed=schema.safeParse(raw);
  if(!parsed.success)return NextResponse.json({error:"Invalid request"},{status:400});
  const {organization_id,agent_id,room_name}=parsed.data;
  let sessionId:string;
  try{const room=parseVoiceRoomName(room_name);if(room.organizationId!==organization_id||room.agentId!==agent_id)return NextResponse.json({error:"Room mismatch"},{status:403});sessionId=room.sessionId}catch{return NextResponse.json({error:"Room mismatch"},{status:403})}
  let s:ReturnType<typeof createWorkerDatabaseClient>;
  try{s=createWorkerDatabaseClient()}catch{return NextResponse.json({error:"Configuration unavailable"},{status:503})}
  const {data,error}=await s.from("agents").select("id,organization_id,language,voice_id,instructions").eq("id",agent_id).eq("organization_id",organization_id).maybeSingle();
  if(error)return NextResponse.json({error:"Configuration unavailable"},{status:503});
  if(!data)return NextResponse.json({error:"Agent not found"},{status:404});
  let authorization;
  try{authorization=await consumeIssuedRoom(room_name,organization_id,agent_id,sessionId)}catch{return NextResponse.json({error:"Security store unavailable"},{status:503})}
  if(!authorization)return NextResponse.json({error:"Room was not authorized"},{status:403});
  return NextResponse.json({agent:{id:data.id,organization_id:data.organization_id,session_id:sessionId,session_expires_at:authorization.expiresAt,language:data.language,voice_id:data.voice_id||null,instructions:data.instructions||"",knowledge_source_ids:[],authorized_browser_identity:authorization.userId}},{headers:{"Cache-Control":"no-store"}});
}
