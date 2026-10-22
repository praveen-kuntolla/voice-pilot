/** Read-only check for an explicitly supplied isolated test room; never auto-selects a room. */
import {readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {parseEnv} from "node:util";
import {RoomServiceClient} from "livekit-server-sdk";

try{
  const root=resolve(import.meta.dirname,"..");
  const values=parseEnv(readFileSync(join(root,".env.livekit-test.local"),"utf8"));
  const fixture=JSON.parse(readFileSync(join(tmpdir(),"voicepilot-local-fixtures.json"),"utf8"));
  if(fixture.api_url!=="http://127.0.0.1:54321" || !fixture.users?.[0]?.organization_id || !fixture.users?.[0]?.agent_id)throw new Error("Invalid fixture");
  const url=new URL(values.LIVEKIT_URL);
  if(url.protocol!=="wss:" || url.hostname!==values.LIVEKIT_TEST_PROJECT_HOST?.toLowerCase() || url.origin!==new URL(values.NEXT_PUBLIC_LIVEKIT_URL).origin)throw new Error("Invalid test project");
  const room=process.env.VOICE_TEST_ROOM_NAME||"";
  const expected=`voicepilot:${fixture.users[0].organization_id}:${fixture.users[0].agent_id}:`;
  if(!room.startsWith(expected)||!/^voicepilot:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(room))throw new Error("Exact isolated session room required");
  const client=new RoomServiceClient(`https://${url.host}`,values.LIVEKIT_API_KEY,values.LIVEKIT_API_SECRET);
  const rooms=await client.listRooms([room]);
  const matching=rooms.filter(item=>item.name===room);
  const participants=matching.reduce((count,item)=>count+Number(item.numParticipants||0),0);
  console.log(`TEST_ROOM_ACTIVE_PARTICIPANTS=${participants}`);
  console.log(`TEST_ROOM_CONNECTION_CLEANUP=${participants===0?"PASS":"FAIL"}`);
  if(participants!==0)process.exitCode=1;
}catch{
  console.error("TEST_ROOM_CONNECTION_CLEANUP=UNVERIFIED; read-only check failed");
  process.exitCode=1;
}
