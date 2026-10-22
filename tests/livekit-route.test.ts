import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {TokenVerifier} from "livekit-server-sdk";
import {currentMembership} from "@/lib/authz";
import {POST} from "@/app/api/livekit/token/route";

vi.mock("@/lib/authz",()=>({currentMembership:vi.fn()}));

const org = "11111111-1111-4111-8111-111111111111";
const agent = "22222222-2222-4222-8222-222222222222";
const env = {
  VOICE_CONNECTIVITY_TEST_ENABLED:"true", VOICE_REALTIME_ENABLED:"false",
  VOICE_OUTBOUND_ENABLED:"false", VOICE_PROVIDER_MODE:"mock",
  LIVEKIT_URL:"wss://isolated-test.livekit.cloud",
  NEXT_PUBLIC_LIVEKIT_URL:"wss://isolated-test.livekit.cloud",
  LIVEKIT_TEST_PROJECT_HOST:"isolated-test.livekit.cloud",
  LIVEKIT_API_KEY:"local-test-key", LIVEKIT_API_SECRET:"local-test-secret-not-deployed",
  NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321",
};

function request(body: unknown) {
  return new Request("http://localhost/api/livekit/token",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}

function membership(agentFound: boolean) {
  const query = {select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:agentFound?{id:agent}:null,error:null})};
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  vi.mocked(currentMembership).mockResolvedValue({
    user:{id:"test-user"},membership:{organization_id:org},
    s:{from:vi.fn().mockReturnValue(query)},organizations:[],
  } as never);
  return query;
}

describe("LiveKit token route authorization",()=>{
  beforeEach(()=>{for(const [key,value] of Object.entries(env))vi.stubEnv(key,value)});
  afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});

  it("rejects unauthenticated users before issuing tokens",async()=>{
    vi.mocked(currentMembership).mockResolvedValue({user:null,membership:null} as never);
    expect((await POST(request({agent_id:agent}))).status).toBe(401);
  });
  it("rejects agents outside the selected organization",async()=>{
    const query=membership(false);
    const response=await POST(request({agent_id:agent}));
    expect(response.status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("organization_id",org);
  });
  it("issues only a room-scoped connectivity token for an owned agent",async()=>{
    membership(true);
    const response=await POST(request({agent_id:agent}));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data=await response.json();
    expect(data).toMatchObject({url:env.LIVEKIT_URL,mode:"connectivity"});
    expect(data.room).toMatch(new RegExp(`^voicepilot:${org}:${agent}:[0-9a-f-]{36}$`));
    const claims=await new TokenVerifier(env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET).verify(data.token);
    expect(claims.video).toMatchObject({roomJoin:true,room:data.room,canPublish:false,canPublishData:false});
    const second=await (await POST(request({agent_id:agent}))).json();
    expect(second.room).not.toBe(data.room);
    const secondClaims=await new TokenVerifier(env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET).verify(second.token);
    expect(secondClaims.video?.room).toBe(second.room);
    expect(claims.video?.room).not.toBe(second.room);
  });
  it("fails closed with missing or conflicting configuration",async()=>{
    membership(true);
    vi.stubEnv("VOICE_OUTBOUND_ENABLED","true");
    expect((await POST(request({agent_id:agent}))).status).toBe(503);
  });
  it("does not accept client-selected or revoked session IDs",async()=>{
    membership(true);
    expect((await POST(request({agent_id:agent,session_id:"33333333-3333-4333-8333-333333333333"}))).status).toBe(400);
  });
});
