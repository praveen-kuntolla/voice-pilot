import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {getVoiceSecurityStore,LocalVoiceSecurityStore,RedisVoiceSecurityStore,type RedisCommandClient} from "@/lib/voice-security-store";
import {voiceRoomName} from "@/lib/livekit";

const org="11111111-1111-4111-8111-111111111111",agent="22222222-2222-4222-8222-222222222222";

class FakeRedis implements RedisCommandClient {
  now=Date.now();
  records=new Map<string,{value:string;expiresAt:number}>();
  async sendCommand(args:string[]):Promise<string|number|null>{
    const [command,...rest]=args;
    const key=command==="EVAL"?rest[2]:rest[0];
    const existing=this.records.get(key);
    if(existing&&existing.expiresAt<=this.now)this.records.delete(key);
    const current=this.records.get(key);
    if(command==="SET"){
      if(rest[2]==="NX"&&current)return null;
      this.records.set(key,{value:rest[1],expiresAt:this.now+Number(rest[4])});return "OK";
    }
    if(command==="EVAL"&&rest[0].includes("cjson.decode")){
      if(!current)return null;
      const payload=JSON.parse(current.value);
      if(rest[0].includes("d.revoked=true")){
        if(payload.authorization.organizationId!==rest[3]||payload.authorization.agentId!==rest[4]||payload.authorization.sessionId!==rest[5]||payload.authorization.userId!==rest[6])return 0;
        payload.revoked=true;this.records.set(key,{value:JSON.stringify(payload),expiresAt:current.expiresAt});return 1;
      }
      if(payload.consumed||payload.authorization.organizationId!==rest[3]||payload.authorization.agentId!==rest[4]||payload.authorization.sessionId!==rest[5])return null;
      if(payload.revoked)return null;
      payload.consumed=true;this.records.set(key,{value:JSON.stringify(payload),expiresAt:current.expiresAt});return current.value;
    }
    if(command==="EVAL"){
      const count=Number(current?.value||0)+1;
      this.records.set(key,{value:String(count),expiresAt:current?.expiresAt||this.now+Number(rest[3])});
      return count<=Number(rest[4])?1:0;
    }
    throw new Error("unexpected fake command");
  }
}

describe("atomic voice security store boundary",()=>{
  it("rejects room replay and cross-tenant or cross-session consumption",async()=>{
    const session=randomUUID(),room=voiceRoomName(org,agent,session),store=new LocalVoiceSecurityStore();
    const auth={organizationId:org,agentId:agent,userId:"user",sessionId:session,expiresAt:Date.now()+1000};
    expect(await store.reserveRoom(room,auth,1000)).toBe(true);
    expect(await store.consumeRoom(room,{organizationId:randomUUID(),agentId:agent,sessionId:session})).toBeNull();
    expect(await store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:randomUUID()})).toBeNull();
    expect((await store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session}))?.userId).toBe("user");
    expect(await store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})).toBeNull();
    expect(await store.reserveRoom(room,auth,1000)).toBe(false);
  });
  it("shares Redis-compatible nonce, room and rate decisions across simulated instances",async()=>{
    const redis=new FakeRedis(),a=new RedisVoiceSecurityStore(redis),b=new RedisVoiceSecurityStore(redis);
    expect(await a.consumeNonce("nonce",1000)).toBe(true);
    expect(await b.consumeNonce("nonce",1000)).toBe(false);
    expect(await a.allowRate("worker",2,1000)).toBe(true);
    expect(await b.allowRate("worker",2,1000)).toBe(true);
    expect(await a.allowRate("worker",2,1000)).toBe(false);
    const session=randomUUID(),room=voiceRoomName(org,agent,session);
    const auth={organizationId:org,agentId:agent,userId:"user",sessionId:session,expiresAt:Date.now()+1000};
    expect(await a.reserveRoom(room,auth,1000)).toBe(true);
    expect(await b.reserveRoom(room,auth,1000)).toBe(false);
    expect((await b.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session}))?.userId).toBe("user");
    expect(await a.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})).toBeNull();
    const otherSession=randomUUID(),otherRoom=voiceRoomName(org,agent,otherSession);
    const otherAuth={...auth,sessionId:otherSession,expiresAt:Date.now()+1000};
    expect(await a.reserveRoom(otherRoom,otherAuth,1000)).toBe(true);
    expect(await b.revokeRoom(otherRoom,{organizationId:org,agentId:agent,sessionId:otherSession,userId:"wrong"})).toBe(false);
    expect(await b.revokeRoom(otherRoom,{organizationId:org,agentId:agent,sessionId:otherSession,userId:"user"})).toBe(true);
    expect(await a.consumeRoom(otherRoom,{organizationId:org,agentId:agent,sessionId:otherSession})).toBeNull();
    redis.now+=1000;
    expect(await b.consumeNonce("nonce",1000)).toBe(true);
    expect(await a.allowRate("worker",2,1000)).toBe(true);
    expect(await a.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})).toBeNull();
  });
  it("revokes a local session without allowing re-registration",async()=>{
    const store=new LocalVoiceSecurityStore(),session=randomUUID(),room=voiceRoomName(org,agent,session);
    const auth={organizationId:org,agentId:agent,userId:"owner",sessionId:session,expiresAt:Date.now()+1000};
    expect(await store.reserveRoom(room,auth,1000)).toBe(true);
    expect(await store.revokeRoom(room,{organizationId:org,agentId:agent,sessionId:session,userId:"intruder"})).toBe(false);
    expect(await store.revokeRoom(room,{organizationId:org,agentId:agent,sessionId:session,userId:"owner"})).toBe(true);
    expect(await store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})).toBeNull();
    expect(await store.reserveRoom(room,auth,1000)).toBe(false);
  });
  it("keeps production fail-closed without an installed distributed client",async()=>{
    vi.stubEnv("NODE_ENV","production");
    try{expect(await getVoiceSecurityStore()).toBeNull()}finally{vi.unstubAllEnvs()}
  });
});
