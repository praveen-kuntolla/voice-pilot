/** One approved connectivity-only local launcher. Private file stays disabled. */
import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {parseEnv} from "node:util";

const projectRoot=resolve(import.meta.dirname,"..");
const privatePath=resolve(projectRoot,".env.livekit-test.local");
let values;
try { values=parseEnv(readFileSync(privatePath,"utf8")); }
catch { throw new Error("Private .env.livekit-test.local is missing or invalid"); }

const required=[
  "NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY",
  "LIVEKIT_URL","NEXT_PUBLIC_LIVEKIT_URL","LIVEKIT_TEST_PROJECT_HOST",
  "LIVEKIT_API_KEY","LIVEKIT_API_SECRET","VOICE_WORKER_SHARED_SECRET","VOICE_CONFIG_ENDPOINT",
];
if(required.some(key=>!values[key] || values[key].startsWith("replace-with-") || values[key].includes("your-isolated-project"))) {
  throw new Error("Isolated test configuration is incomplete");
}
if(process.env.VOICE_CONNECTIVITY_APPROVED_ONCE!=="true" ||
   values.VOICE_CONNECTIVITY_TEST_ENABLED!=="false" || values.VOICE_WORKER_ENABLED!=="false" ||
   values.VOICE_REALTIME_ENABLED!=="false" || values.VOICE_OUTBOUND_ENABLED!=="false" || values.VOICE_PROVIDER_MODE!=="mock") {
  throw new Error("Isolated connectivity flags are not configured safely");
}
const localSupabase=new URL(values.NEXT_PUBLIC_SUPABASE_URL);
const livekit=new URL(values.LIVEKIT_URL);
const browser=new URL(values.NEXT_PUBLIC_LIVEKIT_URL);
if(localSupabase.href!=="http://127.0.0.1:54321/" ||
   livekit.protocol!=="wss:" || livekit.origin!==browser.origin ||
   livekit.hostname!==values.LIVEKIT_TEST_PROJECT_HOST.toLowerCase() ||
   values.VOICE_CONFIG_ENDPOINT!=="http://127.0.0.1:3001/api/internal/voice-agent/config") {
  throw new Error("Local Supabase or isolated LiveKit URL validation failed");
}
const runtimeValues={...values,VOICE_CONNECTIVITY_TEST_ENABLED:"true",VOICE_WORKER_ENABLED:"true"};
const child=spawn(process.execPath,[resolve(projectRoot,"node_modules/next/dist/bin/next"),"dev","-p","3001"],{
  cwd:projectRoot,env:{...process.env,...runtimeValues,NODE_ENV:"development"},stdio:"inherit",
});
child.on("exit",code=>{process.exitCode=code ?? 1});
