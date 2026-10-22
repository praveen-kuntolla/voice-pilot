/** Offline-only preflight: reads a private file and reports no credential values. */
import {readFileSync} from "node:fs";
import {execSync} from "node:child_process";
import {resolve} from "node:path";
import {parseEnv} from "node:util";

const required=[
  "NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY",
  "LIVEKIT_URL","NEXT_PUBLIC_LIVEKIT_URL","LIVEKIT_TEST_PROJECT_HOST",
  "LIVEKIT_API_KEY","LIVEKIT_API_SECRET","VOICE_WORKER_SHARED_SECRET","VOICE_CONFIG_ENDPOINT",
];

export function validateLiveKitTestValues(values){
  const issues=[];
  for(const key of required){
    const value=values[key];
    if(!value || value.startsWith("replace-with-") || value.includes("your-isolated-project"))issues.push(`${key}: missing or placeholder`);
  }
  for(const key of ["VOICE_CONNECTIVITY_TEST_ENABLED","VOICE_WORKER_ENABLED","VOICE_REALTIME_ENABLED","VOICE_OUTBOUND_ENABLED"]){
    if(values[key]!=="false")issues.push(`${key}: must remain disabled before approval`);
  }
  if(values.VOICE_PROVIDER_MODE!=="mock")issues.push("VOICE_PROVIDER_MODE: must be mock");
  for(const key of Object.keys(values)){
    if(key.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_ROLE|API_KEY/i.test(key) && key!=="NEXT_PUBLIC_SUPABASE_ANON_KEY")issues.push(`${key}: secret-like public variable is forbidden`);
  }
  try{
    const local=new URL(values.NEXT_PUBLIC_SUPABASE_URL);
    if(local.protocol!=="http:" || !["127.0.0.1","localhost"].includes(local.hostname) || local.port!=="54321" || local.username || local.password)issues.push("Supabase URL: must target isolated local stack");
  }catch{issues.push("Supabase URL: invalid")}
  try{
    const server=new URL(values.LIVEKIT_URL);
    const browser=new URL(values.NEXT_PUBLIC_LIVEKIT_URL);
    if(server.protocol!=="wss:" || browser.origin!==server.origin || server.hostname!==values.LIVEKIT_TEST_PROJECT_HOST?.toLowerCase() || server.pathname!=="/" || browser.pathname!=="/" || server.username || server.password || browser.username || browser.password || server.search || browser.search || server.hash || browser.hash)issues.push("LiveKit URLs: secure origins or declared test host do not match");
  }catch{issues.push("LiveKit URLs: invalid")}
  try{
    const endpoint=new URL(values.VOICE_CONFIG_ENDPOINT);
    if(endpoint.href!=="http://127.0.0.1:3001/api/internal/voice-agent/config")issues.push("Worker endpoint: must be exact local test route");
  }catch{issues.push("Worker endpoint: invalid")}
  return issues;
}

export function compareLocalSupabaseKeys(values,status){
  const issues=[];
  if(status.API_URL!=="http://127.0.0.1:54321" || values.NEXT_PUBLIC_SUPABASE_URL!==status.API_URL)issues.push("Supabase URL: does not match isolated local CLI stack");
  if(!status.ANON_KEY || values.NEXT_PUBLIC_SUPABASE_ANON_KEY!==status.ANON_KEY)issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: does not match isolated local CLI key");
  if(!status.SERVICE_ROLE_KEY || values.SUPABASE_SERVICE_ROLE_KEY!==status.SERVICE_ROLE_KEY)issues.push("SUPABASE_SERVICE_ROLE_KEY: does not match isolated local CLI key");
  return issues;
}

if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)){
  const privatePath=resolve(import.meta.dirname,"..",".env.livekit-test.local");
  let values;
  try{values=parseEnv(readFileSync(privatePath,"utf8"))}
  catch{console.error("BLOCKED: private isolated test configuration file is missing or unreadable");process.exitCode=1}
  if(values){
    const issues=validateLiveKitTestValues(values);
    if(process.argv.includes("--verify-local-keys")){
      try{
        const output=execSync("npx.cmd supabase status -o json",{cwd:resolve(import.meta.dirname,".."),encoding:"utf8",timeout:20000,stdio:["ignore","pipe","pipe"],windowsHide:true});
        issues.push(...compareLocalSupabaseKeys(values,JSON.parse(output)));
      }catch{issues.push("Local Supabase CLI status: unavailable; keys were not verified")}
    }
    if(issues.length){for(const issue of issues)console.error(`BLOCKED: ${issue}`);process.exitCode=1}
    else console.log(`READY FOR APPROVAL REVIEW: configuration shape passes${process.argv.includes("--verify-local-keys")?" and local Supabase keys match CLI status":""}; LiveKit project ownership and credentials are not remotely verified; no connection started`);
  }
}
