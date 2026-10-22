/** Read-only scan of built browser assets; never prints secret values. */
import {readFileSync,readdirSync,statSync} from "node:fs";
import {resolve,join} from "node:path";
import {parseEnv} from "node:util";

try{
  const root=resolve(import.meta.dirname,"..");
  const values=parseEnv(readFileSync(join(root,".env.livekit-test.local"),"utf8"));
  const secrets=[values.LIVEKIT_API_SECRET,values.VOICE_WORKER_SHARED_SECRET,values.SUPABASE_SERVICE_ROLE_KEY].filter(value=>value && !value.startsWith("replace-with-"));
  if(secrets.length!==3)throw new Error("Private test secrets incomplete");
  let files=0,matches=0;
  function walk(dir){
    for(const entry of readdirSync(dir)){
      const path=join(dir,entry),stat=statSync(path);
      if(stat.isDirectory())walk(path);
      else if(stat.isFile()){
        files++;
        const content=readFileSync(path);
        if(secrets.some(secret=>content.includes(Buffer.from(secret))))matches++;
      }
    }
  }
  walk(join(root,".next","static"));
  if(files===0 || matches)throw new Error("Browser asset scan did not pass");
  console.log(`CLIENT_BUNDLE_SECRET_MATCHES=0; scanned ${files} built browser assets`);
}catch{
  console.error("CLIENT_BUNDLE_SECRET_SCAN_BLOCKED_OR_FAILED; no values displayed");
  process.exitCode=1;
}
