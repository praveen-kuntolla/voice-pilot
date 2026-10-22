import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {POST} from "@/app/api/internal/voice-agent/config/route";
import {createWorkerDatabaseClient} from "@/lib/supabase/worker";
import {workerSignature} from "@/lib/worker-auth";
import {registerIssuedRoom,revokeIssuedRoom} from "@/lib/livekit-room-auth";

vi.mock("@/lib/supabase/worker",()=>({createWorkerDatabaseClient:vi.fn()}));

const org="11111111-1111-4111-8111-111111111111";
const agent="22222222-2222-4222-8222-222222222222";
const session="33333333-3333-4333-8333-333333333333";
const room=`voicepilot:${org}:${agent}:${session}`;
const path="/api/internal/voice-agent/config";
const secret="local-test-worker-secret-not-deployed";

function request(organizationId=org,agentId=agent,roomName=room) {
  const body=JSON.stringify({organization_id:organizationId,agent_id:agentId,room_name:roomName});
  const timestamp=String(Date.now());
  const nonce=randomUUID().replaceAll("-","");
  return new Request(`http://localhost${path}`,{
    method:"POST",body,
    headers:{"content-type":"application/json","x-voice-worker-timestamp":timestamp,
      "x-voice-worker-nonce":nonce,"x-voice-worker-signature":workerSignature("POST",path,body,timestamp,nonce,secret)},
  });
}

function database(found:boolean) {
  const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({
    data:found?{id:agent,organization_id:org,language:"en-US",voice_id:null,instructions:"Test agent"}:null,error:null,
  })};
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  vi.mocked(createWorkerDatabaseClient).mockReturnValue({from:vi.fn().mockReturnValue(query)} as never);
  return query;
}

describe("signed worker configuration boundary",()=>{
  afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
  it("stays disabled without worker activation",async()=>{
    expect((await POST(request())).status).toBe(503);
    expect(createWorkerDatabaseClient).not.toHaveBeenCalled();
  });
  it("returns only scoped execution fields for a valid local service request",async()=>{
    vi.stubEnv("VOICE_WORKER_ENABLED","true");vi.stubEnv("VOICE_WORKER_SHARED_SECRET",secret);
    const query=database(true);
    await registerIssuedRoom(room,org,agent,"test-user",session);
    const response=await POST(request());
    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("organization_id",org);
    expect(await response.json()).toEqual({agent:{id:agent,organization_id:org,session_id:session,session_expires_at:expect.any(Number),language:"en-US",voice_id:null,instructions:"Test agent",knowledge_source_ids:[],authorized_browser_identity:"test-user"}});
    expect((await POST(request())).status).toBe(403);
  });
  it("refuses configuration without a recently issued browser room",async()=>{
    vi.stubEnv("VOICE_WORKER_ENABLED","true");vi.stubEnv("VOICE_WORKER_SHARED_SECRET",secret);
    database(true);
    expect((await POST(request())).status).toBe(403);
  });
  it("refuses configuration for a locally revoked session",async()=>{
    vi.stubEnv("VOICE_WORKER_ENABLED","true");vi.stubEnv("VOICE_WORKER_SHARED_SECRET",secret);
    database(true);
    const revokedSession=randomUUID(),revokedRoom=`voicepilot:${org}:${agent}:${revokedSession}`;
    expect(await registerIssuedRoom(revokedRoom,org,agent,"test-user",revokedSession)).toBe(true);
    expect(await revokeIssuedRoom(revokedRoom,org,agent,revokedSession,"test-user")).toBe(true);
    expect((await POST(request(org,agent,revokedRoom))).status).toBe(403);
  });
  it("rejects cross-organization lookups and invalid signatures",async()=>{
    vi.stubEnv("VOICE_WORKER_ENABLED","true");vi.stubEnv("VOICE_WORKER_SHARED_SECRET",secret);
    database(false);
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request("33333333-3333-4333-8333-333333333333",agent))).status).toBe(403);
    const bad=request();bad.headers.set("x-voice-worker-signature","0".repeat(64));
    expect((await POST(bad)).status).toBe(401);
  });
  it("fails closed in production even if a distributed store is claimed in configuration",async()=>{
    vi.stubEnv("NODE_ENV","production");
    vi.stubEnv("VOICE_WORKER_ENABLED","true");
    vi.stubEnv("VOICE_WORKER_RATE_LIMIT_STORE","distributed");
    vi.stubEnv("VOICE_WORKER_REPLAY_STORE","distributed");
    expect((await POST(request())).status).toBe(503);
    expect(createWorkerDatabaseClient).not.toHaveBeenCalled();
  });
});
