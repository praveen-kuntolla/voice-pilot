/** Exactly one browser room-join attempt. No traces, screenshots, or token output. */
import {readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {chromium} from "@playwright/test";

let browser,stage="fixture_validation";
try{
  if(process.env.VOICE_CONNECTIVITY_APPROVED_ONCE!=="true")throw new Error("Not approved");
  const fixture=JSON.parse(readFileSync(join(tmpdir(),"voicepilot-local-fixtures.json"),"utf8"));
  if(fixture.api_url!=="http://127.0.0.1:54321" || !fixture.users?.[0]?.organization_id || !fixture.users?.[0]?.agent_id)throw new Error("Invalid local fixture");
  const user=fixture.users[0];
  browser=await chromium.launch();
  const context=await browser.newContext({baseURL:"http://localhost:3001"});
  const page=await context.newPage();
  await page.addInitScript(()=>{
    window.__voicepilotMicCalls=0;
    if(navigator.mediaDevices){
      Object.defineProperty(navigator.mediaDevices,"getUserMedia",{configurable:true,value:async()=>{window.__voicepilotMicCalls++;throw new DOMException("Microphone forbidden in connectivity test","NotAllowedError")}});
    }
  });
  stage="local_authentication";
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button",{name:/log in/i}).click();
  await page.waitForURL(url=>url.pathname.startsWith("/dashboard"),{timeout:15000});
  console.log("LOCAL_AUTHENTICATION=PASS");

  stage="organization_and_agent";
  await page.goto("/dashboard");
  const selector=page.getByLabel("Organization");
  if(await selector.count()){
    const selected=await selector.locator("option:checked").textContent();
    if(selected?.trim()!=="E2E Workspace A")await selector.selectOption({label:"E2E Workspace A"});
  }
  await page.goto("/dashboard/agents");
  await page.getByText("E2E Agent A").waitFor({timeout:10000});
  if(await page.getByText("E2E Agent B").count())throw new Error("Cross-tenant agent visible");
  console.log("ORGANIZATION_AGENT_AUTHORIZATION=PASS");

  stage="single_room_connect";
  await page.goto("/dashboard/agents/test");
  await page.getByPlaceholder("Test agent ID").fill(user.agent_id);
  const tokenResponsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/livekit/token",{timeout:15000});
  await page.getByRole("button",{name:"Connect to LiveKit"}).click();
  const tokenResponse=await tokenResponsePromise;
  if(tokenResponse.status()!==200)throw new Error("Token authorization rejected");
  console.log("AUTHORIZED_CONNECTIVITY_TOKEN=PASS");
  await page.getByText("Status: connected").waitFor({timeout:25000});
  console.log("BROWSER_CONNECTION=PASS");
  stage="participant_visibility";
  await page.getByText("Remote participants: 1").waitFor({timeout:25000});
  console.log("REMOTE_PARTICIPANT_VISIBLE=PASS");
  const micCalls=await page.evaluate(()=>window.__voicepilotMicCalls||0);
  if(micCalls!==0)throw new Error("Microphone API called");
  console.log("MICROPHONE_CALLS=0");

  stage="browser_disconnect";
  await page.getByRole("button",{name:/End session/i}).click();
  await page.getByText("Status: ended").waitFor({timeout:10000});
  if(await page.getByText(/Remote participants:/).count())throw new Error("Participant state not cleared");
  console.log("BROWSER_DISCONNECT_AND_STATE_RESET=PASS");
  await context.close();
}catch{
  console.error(`CONNECTIVITY_BROWSER_FAILED_AT=${stage}`);
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
}
