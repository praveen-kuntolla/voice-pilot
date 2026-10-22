export async function GET(){return Response.json({status:"ok",service:"voicepilot-ai",databaseConfigured:Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),timestamp:new Date().toISOString()})}
