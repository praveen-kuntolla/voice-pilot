import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {createRedisSecurityConnection,type RedisSecurityConnection} from "@/lib/redis-security-client";
import {closeVoiceSecurityConnection,getVoiceSecurityStore} from "@/lib/voice-security-store";
import {voiceRoomName} from "@/lib/livekit";

const localUrl=process.env.VOICE_TEST_REDIS_URL;
const suite=localUrl?describe:describe.skip;
const org="11111111-1111-4111-8111-111111111111",agent="22222222-2222-4222-8222-222222222222";

suite("real disposable localhost Redis",()=>{
  const prefix=`voicepilot:test:${randomUUID()}:`;
  let a:RedisSecurityConnection,b:RedisSecurityConnection;
  beforeAll(async()=>{
    a=await createRedisSecurityConnection(localUrl!,prefix);
    b=await createRedisSecurityConnection(localUrl!,prefix);
  });
  afterAll(()=>{a?.close();b?.close()});

  it("atomically consumes a nonce once under concurrent requests",async()=>{
    const results=await Promise.all(Array.from({length:20},(_,index)=>(index%2?a:b).store.consumeNonce("simultaneous",30000)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await b.store.consumeNonce("simultaneous",30000)).toBe(false);
  });
  it("reserves and consumes an exact tenant room once across connections",async()=>{
    const session=randomUUID(),room=voiceRoomName(org,agent,session);
    const auth={organizationId:org,agentId:agent,userId:"local-user",sessionId:session,expiresAt:Date.now()+30000};
    expect(await a.store.reserveRoom(room,auth,30000)).toBe(true);
    expect(await b.store.reserveRoom(room,auth,30000)).toBe(false);
    expect(await b.store.consumeRoom(room,{organizationId:randomUUID(),agentId:agent,sessionId:session})).toBeNull();
    const results=await Promise.all([a.store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session}),b.store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)?.userId).toBe("local-user");
    expect(await a.store.reserveRoom(room,auth,30000)).toBe(false);
  });
  it("enforces a shared expiring rate limit",async()=>{
    const results=await Promise.all(Array.from({length:9},(_,index)=>(index%2?a:b).store.allowRate("worker-config",4,10000)));
    expect(results.filter(Boolean)).toHaveLength(4);
  });
  it("rejects wrong-user revocation and blocks config consumption after revocation",async()=>{
    const session=randomUUID(),room=voiceRoomName(org,agent,session);
    const auth={organizationId:org,agentId:agent,userId:"local-user",sessionId:session,expiresAt:Date.now()+30000};
    expect(await a.store.reserveRoom(room,auth,30000)).toBe(true);
    expect(await b.store.revokeRoom(room,{organizationId:org,agentId:agent,sessionId:session,userId:"other-user"})).toBe(false);
    expect(await b.store.revokeRoom(room,{organizationId:org,agentId:agent,sessionId:session,userId:"local-user"})).toBe(true);
    expect(await a.store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})).toBeNull();
    expect(await a.store.reserveRoom(room,auth,30000)).toBe(false);
  });
  it("expires nonce and room keys",async()=>{
    expect(await a.store.consumeNonce("short-lived",70)).toBe(true);
    const session=randomUUID(),room=voiceRoomName(org,agent,session);
    const auth={organizationId:org,agentId:agent,userId:"local-user",sessionId:session,expiresAt:Date.now()+90};
    expect(await a.store.reserveRoom(room,auth,90)).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,150));
    expect(await b.store.consumeNonce("short-lived",70)).toBe(true);
    expect(await b.store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})).toBeNull();
  });
  it("fails closed on a lost client and recovers through a new connection",async()=>{
    expect(await a.store.consumeNonce("before-loss",30000)).toBe(true);
    a.close();
    await expect(a.store.consumeNonce("after-loss",30000)).rejects.toThrow();
    expect(await b.store.consumeNonce("before-loss",30000)).toBe(false);
    a=await createRedisSecurityConnection(localUrl!,prefix);
    expect(await a.store.consumeNonce("after-loss",30000)).toBe(true);
  });
  it("keeps nonce state after a separate client process exits unexpectedly",async()=>{
    const childCode=`(async()=>{const {createClient}=await import('redis');const c=createClient({url:process.env.VOICE_TEST_REDIS_URL});c.on('error',()=>{});await c.connect();await c.sendCommand(['SET',process.env.VOICE_TEST_REDIS_PREFIX+'nonce:process-exit','1','NX','PX','30000']);process.exit(17)})().catch(()=>process.exit(18))`;
    const result=spawnSync(process.execPath,["-e",childCode],{cwd:process.cwd(),env:{...process.env,VOICE_TEST_REDIS_PREFIX:prefix},encoding:"utf8",timeout:5000});
    expect(result.status).toBe(17);
    expect(await b.store.consumeNonce("process-exit",30000)).toBe(false);
  });
  it("selects the real Redis boundary when explicitly configured",async()=>{
    const {vi}=await import("vitest");
    vi.stubEnv("VOICE_SECURITY_STORE","redis");
    vi.stubEnv("VOICE_REDIS_URL",localUrl!);
    vi.stubEnv("VOICE_REDIS_PREFIX",prefix);
    try{
      const store=await getVoiceSecurityStore();
      expect(store).not.toBeNull();
      expect(await store!.consumeNonce("boundary-check",30000)).toBe(true);
      expect(await b.store.consumeNonce("boundary-check",30000)).toBe(false);
    }finally{closeVoiceSecurityConnection();vi.unstubAllEnvs()}
  });
});
