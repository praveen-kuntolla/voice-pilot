/** One approved external connectivity attempt. Never prints secrets or tokens. */
import {spawn,execFileSync,execSync} from "node:child_process";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {parseEnv} from "node:util";
import {validateLiveKitTestValues,compareLocalSupabaseKeys} from "./check-livekit-test-config.mjs";

const root=resolve(import.meta.dirname,"..");
const privatePath=join(root,".env.livekit-test.local");
const marker=join(tmpdir(),"voicepilot-livekit-one-approved-attempt.marker");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let next=null,worker=null,stage="preflight",attempted=false,workerOutput="";

async function waitFor(predicate,timeoutMs,stopped=()=>false){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(await predicate())return true;
    if(stopped())return false;
    await sleep(250);
  }
  return await predicate();
}
function stopOwnedProcess(child){
  if(!child?.pid || child.exitCode!==null)return;
  try{
    if(process.platform==="win32")execFileSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore",windowsHide:true,timeout:10000});
    else child.kill("SIGTERM");
  }catch{/* The process may already have exited. */}
}

try{
  if(process.env.VOICE_CONNECTIVITY_APPROVED_ONCE!=="true")throw new Error("approval marker absent");
  if(existsSync(marker))throw new Error("approved attempt already consumed");
  execSync("git check-ignore -q .env.livekit-test.local",{cwd:root,stdio:"ignore",windowsHide:true});
  const values=parseEnv(readFileSync(privatePath,"utf8"));
  if(validateLiveKitTestValues(values).length)throw new Error("private safety preflight failed");
  const status=JSON.parse(execSync("npx.cmd supabase status -o json",{cwd:root,encoding:"utf8",timeout:20000,stdio:["ignore","pipe","pipe"],windowsHide:true}));
  if(compareLocalSupabaseKeys(values,status).length)throw new Error("local Supabase keys mismatch");
  const fixture=JSON.parse(readFileSync(join(tmpdir(),"voicepilot-local-fixtures.json"),"utf8"));
  if(fixture.api_url!==status.API_URL || !fixture.users?.[0]?.agent_id || !fixture.users?.[0]?.organization_id)throw new Error("isolated fixture missing");
  console.log("PREFLIGHT=PASS; private flags remain disabled");

  stage="local_next_start";
  const approvedEnv={...process.env,VOICE_CONNECTIVITY_APPROVED_ONCE:"true"};
  next=spawn(process.execPath,[join(root,"scripts","run-isolated-livekit-next.mjs")],{cwd:root,env:approvedEnv,stdio:["ignore","pipe","pipe"],windowsHide:true});
  next.stdout.on("data",()=>{});next.stderr.on("data",()=>{});
  next.on("error",()=>{});
  const healthy=await waitFor(async()=>{
    try{return (await fetch("http://localhost:3001/api/health",{signal:AbortSignal.timeout(1000)})).status===200}catch{return false}
  },30000,()=>next.exitCode!==null);
  if(!healthy)throw new Error("local test server unavailable");
  console.log("LOCAL_CONNECTIVITY_SERVER=PASS");

  stage="worker_registration";
  writeFileSync(marker,new Date().toISOString(),{flag:"wx"});
  attempted=true;
  worker=spawn("python",[join(root,"workers","voice-agent","run_worker.py"),"dev"],{
    cwd:root,env:{...approvedEnv,VOICE_TEST_ENV_FILE:privatePath},stdio:["ignore","pipe","pipe"],windowsHide:true,
  });
  const collect=chunk=>{workerOutput=(workerOutput+String(chunk)).slice(-65536)};
  worker.stdout.on("data",collect);worker.stderr.on("data",collect);
  worker.on("error",()=>{});
  const registered=await waitFor(()=>workerOutput.toLowerCase().includes("registered worker"),45000,()=>worker.exitCode!==null);
  if(!registered)throw new Error("worker did not register");
  console.log("WORKER_REGISTRATION=PASS");

  stage="single_browser_room_test";
  const browser=spawn(process.execPath,[join(root,"scripts","livekit-connectivity-browser-once.mjs")],{
    cwd:root,env:approvedEnv,stdio:["ignore","pipe","pipe"],windowsHide:true,
  });
  let browserOutput="";
  browser.stdout.on("data",chunk=>{browserOutput+=String(chunk)});
  browser.stderr.on("data",chunk=>{browserOutput+=String(chunk)});
  browser.on("error",()=>{});
  let browserTimeout;
  const browserExit=await Promise.race([
    new Promise(resolve=>browser.once("exit",code=>resolve(code))),
    new Promise(resolve=>{browserTimeout=setTimeout(()=>resolve("timeout"),85000)}),
  ]);
  clearTimeout(browserTimeout);
  if(browserExit==="timeout")stopOwnedProcess(browser);
  for(const line of browserOutput.split(/\r?\n/)){
    if(/^(LOCAL_AUTHENTICATION|ORGANIZATION_AGENT_AUTHORIZATION|AUTHORIZED_CONNECTIVITY_TOKEN|BROWSER_CONNECTION|REMOTE_PARTICIPANT_VISIBLE|MICROPHONE_CALLS|BROWSER_DISCONNECT_AND_STATE_RESET|CONNECTIVITY_BROWSER_FAILED_AT)=/.test(line))console.log(line);
  }
  if(browserExit!==0)throw new Error("browser room test failed");

  stage="worker_room_cleanup";
  const joined=workerOutput.includes("VOICEPILOT_CONNECTIVITY_WORKER_JOINED");
  const configVerified=workerOutput.includes("VOICEPILOT_CONNECTIVITY_CONFIG_VERIFIED");
  console.log(`WORKER_CONFIG_VERIFIED=${configVerified?"PASS":"UNVERIFIED"}`);
  console.log(`WORKER_ROOM_JOIN=${joined?"PASS":"UNVERIFIED"}`);
  const disconnected=await waitFor(()=>workerOutput.includes("VOICEPILOT_CONNECTIVITY_WORKER_DISCONNECTED"),15000,()=>worker.exitCode!==null);
  console.log(`WORKER_SESSION_DISCONNECT=${disconnected?"PASS":"UNVERIFIED"}`);
  if(!configVerified || !joined || !disconnected)throw new Error("worker lifecycle could not be fully verified");
  console.log("ONE_CONNECTIVITY_TEST=PASS");
}catch{
  if(stage==="worker_registration"){
    const log=workerOutput.toLowerCase();
    const category=/unauthorized|invalid.*(key|secret)|401|403/.test(log)?"CREDENTIAL_REJECTION":/timeout|dns|connect|network/.test(log)?"NETWORK_OR_TIMEOUT":"STARTUP_OR_UNKNOWN";
    console.error(`WORKER_REGISTRATION_ERROR_CATEGORY=${category}`);
  }
  console.error(`ONE_CONNECTIVITY_TEST=FAIL_AT_${stage}`);
  process.exitCode=1;
}finally{
  stopOwnedProcess(worker);
  stopOwnedProcess(next);
  await sleep(800);
  console.log(`WORKER_PROCESS_STOPPED=${worker && worker.exitCode===null?"CHECK_REQUIRED":"PASS"}`);
  console.log(`LOCAL_TEST_SERVER_STOPPED=${next && next.exitCode===null?"CHECK_REQUIRED":"PASS"}`);
  console.log(`APPROVED_ATTEMPT_CONSUMED=${attempted?"YES":"NO"}`);
  try{
    const values=parseEnv(readFileSync(privatePath,"utf8"));
    console.log(`PRIVATE_FLAGS_DISABLED=${validateLiveKitTestValues(values).length===0?"PASS":"FAIL"}`);
  }catch{console.log("PRIVATE_FLAGS_DISABLED=UNVERIFIED")}
}
