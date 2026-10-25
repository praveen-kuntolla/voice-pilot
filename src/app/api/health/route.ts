import { isSupabaseConfigured } from "@/lib/env";

export async function GET(){return Response.json({status:"ok",service:"voicepilot-ai",databaseConfigured:isSupabaseConfigured,timestamp:new Date().toISOString()})}
