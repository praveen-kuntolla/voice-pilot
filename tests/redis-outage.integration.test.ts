import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createRedisSecurityConnection} from "@/lib/redis-security-client";
import {getVoiceSecurityStore} from "@/lib/voice-security-store";
import {registerIssuedRoom} from "@/lib/livekit-room-auth";
import {voiceRoomName} from "@/lib/livekit";

const suite=process.env.VOICE_TEST_REDIS_OUTAGE==="true"?describe:describe.skip;
suite("paused disposable localhost Redis fails closed",()=>{
  it("denies connection, store acquisition and new room authorization",async()=>{
    const url=process.env.VOICE_TEST_REDIS_URL||"";
    await expect(createRedisSecurityConnection(url,`voicepilot:test:${randomUUID()}:`)).rejects.toThrow(/unavailable/);
    vi.stubEnv("VOICE_SECURITY_STORE","redis");
    vi.stubEnv("VOICE_REDIS_URL",url);
    vi.stubEnv("VOICE_REDIS_PREFIX",`voicepilot:test:${randomUUID()}:`);
    try{
      expect(await getVoiceSecurityStore()).toBeNull();
      const org="11111111-1111-4111-8111-111111111111",agent="22222222-2222-4222-8222-222222222222",session=randomUUID();
      expect(await registerIssuedRoom(voiceRoomName(org,agent,session),org,agent,"local-user",session)).toBe(false);
    }finally{vi.unstubAllEnvs()}
  },15000);
});
