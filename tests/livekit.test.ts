import {describe,expect,it} from "vitest";
import {TokenVerifier} from "livekit-server-sdk";
import {canCreateRealtimeSession,createLiveKitToken,getLiveKitConfiguration,livekitFlags,voiceRoomName} from "@/lib/livekit";

const org = "11111111-1111-4111-8111-111111111111";
const agent = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const testEnv = {
  VOICE_CONNECTIVITY_TEST_ENABLED:"true",
  VOICE_REALTIME_ENABLED:"false",
  VOICE_OUTBOUND_ENABLED:"false",
  VOICE_PROVIDER_MODE:"mock",
  LIVEKIT_URL:"wss://isolated-test.livekit.cloud",
  NEXT_PUBLIC_LIVEKIT_URL:"wss://isolated-test.livekit.cloud",
  LIVEKIT_TEST_PROJECT_HOST:"isolated-test.livekit.cloud",
  LIVEKIT_API_KEY:"local-test-key",
  LIVEKIT_API_SECRET:"local-test-secret-not-deployed",
  NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321",
};

describe("LiveKit safety flags",()=>{
  it("defaults to mock mode with external features disabled",()=>{
    expect(livekitFlags.mockMode).toBe(true);
    expect(livekitFlags.realtimeEnabled).toBe(false);
    expect(livekitFlags.connectivityTestEnabled).toBe(false);
    expect(livekitFlags.outboundCallingEnabled).toBe(false);
    expect(canCreateRealtimeSession()).toBe(false);
  });
  it("requires matching secure URLs and the declared isolated project",()=>{
    expect(getLiveKitConfiguration(testEnv).mode).toBe("connectivity");
    expect(()=>getLiveKitConfiguration({...testEnv,NEXT_PUBLIC_LIVEKIT_URL:"wss://other.livekit.cloud"})).toThrow(/differ/);
    expect(()=>getLiveKitConfiguration({...testEnv,LIVEKIT_TEST_PROJECT_HOST:"other.livekit.cloud"})).toThrow(/host/);
    expect(()=>getLiveKitConfiguration({...testEnv,LIVEKIT_URL:"ws://isolated-test.livekit.cloud"})).toThrow(/secure/);
    expect(()=>getLiveKitConfiguration({...testEnv,NEXT_PUBLIC_SUPABASE_URL:"https://production.supabase.co"})).toThrow(/local Supabase/);
  });
  it("rejects outbound, provider, and conflicting activation flags",()=>{
    expect(()=>getLiveKitConfiguration({...testEnv,VOICE_OUTBOUND_ENABLED:"true"})).toThrow(/Outbound/);
    expect(()=>getLiveKitConfiguration({...testEnv,VOICE_PROVIDER_MODE:"real"})).toThrow(/mock/);
    expect(()=>getLiveKitConfiguration({...testEnv,VOICE_REALTIME_ENABLED:"true"})).toThrow(/Exactly one/);
    expect(()=>getLiveKitConfiguration({...testEnv,VOICE_CONNECTIVITY_TEST_ENABLED:"false"})).toThrow(/Exactly one/);
  });
  it("issues a five-minute, room-scoped connectivity token without publication or telephony grants",async()=>{
    const room=voiceRoomName(org,agent,session);
    const jwt=await createLiveKitToken({identity:"test-user",room},getLiveKitConfiguration(testEnv));
    const claims=await new TokenVerifier(testEnv.LIVEKIT_API_KEY,testEnv.LIVEKIT_API_SECRET).verify(jwt);
    const payload=JSON.parse(Buffer.from(jwt.split(".")[1],"base64url").toString("utf8"));
    expect(claims.sub).toBe("test-user");
    const remaining=payload.exp-Math.floor(Date.now()/1000);
    expect(remaining).toBeGreaterThanOrEqual(299);
    expect(remaining).toBeLessThanOrEqual(301);
    expect(claims.video).toMatchObject({room,roomJoin:true,canPublish:false,canSubscribe:true,canPublishData:false});
    expect(claims.sip).toBeUndefined();
    expect(claims.video?.roomCreate).not.toBe(true);
    expect(claims.video?.roomAdmin).not.toBe(true);
  });
  it("does not accept arbitrary room names",()=>{
    expect(()=>voiceRoomName("foreign-room",agent,session)).toThrow();
  });
});
