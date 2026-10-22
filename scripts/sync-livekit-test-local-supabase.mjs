/** Overwrite only the three local Supabase settings in the Git-ignored test file. */
import {execSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {parseEnv} from "node:util";

try{
  const projectRoot=resolve(import.meta.dirname,"..");
  const privatePath=resolve(projectRoot,".env.livekit-test.local");
  execSync("git check-ignore -q .env.livekit-test.local",{cwd:projectRoot,stdio:"ignore",windowsHide:true});
  const original=readFileSync(privatePath,"utf8");
  const parsed=parseEnv(original);
  if(!parsed.LIVEKIT_URL || !parsed.LIVEKIT_API_KEY || !parsed.LIVEKIT_API_SECRET)throw new Error("Private test configuration is incomplete");
  const output=execSync("npx.cmd supabase status -o json",{cwd:projectRoot,encoding:"utf8",timeout:20000,stdio:["ignore","pipe","pipe"],windowsHide:true});
  const status=JSON.parse(output);
  if(status.API_URL!=="http://127.0.0.1:54321" || !status.ANON_KEY || !status.SERVICE_ROLE_KEY)throw new Error("Local Supabase status is unavailable");
  const replacements={
    NEXT_PUBLIC_SUPABASE_URL:status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,
  };
  let updated=original;
  for(const [key,value] of Object.entries(replacements)){
    if(!value || /[\r\n]/.test(value))throw new Error("Local CLI key format is invalid");
    const line=new RegExp(`^${key}=.*$`,"m");
    if(!line.test(updated))throw new Error("Private test file is missing a required key name");
    updated=updated.replace(line,`${key}=${value}`);
  }
  writeFileSync(privatePath,updated,{encoding:"utf8",flag:"w"});
  console.log("Updated only local Supabase URL and keys in the ignored private test file; no values displayed");
}catch{
  console.error("Local Supabase key sync failed; no credentials displayed");
  process.exitCode=1;
}
