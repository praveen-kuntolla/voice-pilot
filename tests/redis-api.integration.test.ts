import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {POST as workerConfig} from "@/app/api/internal/voice-agent/config/route";
import {createWorkerDatabaseClient} from "@/lib/supabase/worker";
import {registerIssuedRoom,revokeIssuedRoom} from "@/lib/livekit-room-auth";
import {voiceRoomName} from "@/lib/livekit";
import {workerSignature} from "@/lib/worker-auth";
import {closeVoiceSecurityConnection} from "@/lib/voice-security-store";

vi.mock("@/lib/supabase/worker",()=>({createWorkerDatabaseClient:vi.fn()}));
const suite=process.env.VOICE_TEST_REDIS_URL?describe:describe.skip;
const org="11111111-1111-4111-8111-111111111111",agent="22222222-2222-4222-8222-222222222222";
const path="/api/internal/voice-agent/config",secret="local-test-only-hmac-secret";

function request(room:string){
  const body=JSON.stringify({organization_id:org,agent_id:agent,room_name:room});
  const timestamp=String(Date.now()),nonce=randomUUID().replaceAll("-","");
  return new Request(`http://localhost${path}`,{method:"POST",body,headers:{"content-type":"application/json","x-voice-worker-timestamp":timestamp,"x-voice-worker-nonce":nonce,"x-voice-worker-signature":workerSignature("POST",path,body,timestamp,nonce,secret)}});
}
suite("worker configuration with real local Redis",()=>{
  beforeAll(()=>{
    vi.stubEnv("VOICE_SECURITY_STORE","redis");
    vi.stubEnv("VOICE_REDIS_URL",process.env.VOICE_TEST_REDIS_URL!);
    vi.stubEnv("VOICE_REDIS_PREFIX",`voicepilot:test:${randomUUID()}:`);
    vi.stubEnv("VOICE_WORKER_ENABLED","true");
    vi.stubEnv("VOICE_WORKER_SHARED_SECRET",secret);
    const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:{id:agent,organization_id:org,language:"en-US",voice_id:null,instructions:"Local fixture"},error:null})};
    query.select.mockReturnValue(query);query.eq.mockReturnValue(query);
    vi.mocked(createWorkerDatabaseClient).mockReturnValue({from:vi.fn().mockReturnValue(query)} as never);
  });
  afterAll(()=>{closeVoiceSecurityConnection();vi.unstubAllEnvs();vi.clearAllMocks()});
  it("returns tenant-bound configuration once, then rejects replay",async()=>{
    const session=randomUUID(),room=voiceRoomName(org,agent,session);
    expect(await registerIssuedRoom(room,org,agent,"local-user",session)).toBe(true);
    const first=await workerConfig(request(room));
    expect(first.status).toBe(200);
    expect((await first.json()).agent).toMatchObject({session_id:session,authorized_browser_identity:"local-user"});
    expect((await workerConfig(request(room))).status).toBe(403);
  });
  it("rejects worker retrieval after application-level session revocation",async()=>{
    const session=randomUUID(),room=voiceRoomName(org,agent,session);
    expect(await registerIssuedRoom(room,org,agent,"local-user",session)).toBe(true);
    expect(await revokeIssuedRoom(room,org,agent,session,"local-user")).toBe(true);
    expect((await workerConfig(request(room))).status).toBe(403);
  });
});
