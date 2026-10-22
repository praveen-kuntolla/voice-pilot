import {createSupabaseServerClient} from "@/lib/supabase/server";
import {cookies} from "next/headers";
export async function currentMembership(){const s=await createSupabaseServerClient();const {data:{user}}=await s.auth.getUser();if(!user)return {s,user:null,membership:null,organizations:[]};const selected=(await cookies()).get("voicepilot_org")?.value;const {data:organizations}=await s.from("organization_members").select("organization_id,role").eq("user_id",user.id);const membership=selected?(organizations||[]).find(x=>x.organization_id===selected)||null:(organizations||[])[0]||null;return {s,user,membership,organizations:organizations||[]};}
export function canWrite(role:string|undefined){return role==='owner'||role==='admin';}
