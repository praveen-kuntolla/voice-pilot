/** Atomic voice-session security boundary. No remote store is opened automatically. */
import {createHash} from "node:crypto";
export type RoomAuthorization={organizationId:string;agentId:string;userId:string;sessionId:string;expiresAt:number};
export type RoomMatch=Pick<RoomAuthorization,"organizationId"|"agentId"|"sessionId">;
export type RoomRevocationMatch=RoomMatch&Pick<RoomAuthorization,"userId">;
export interface VoiceSecurityStore {
  reserveRoom(room:string,authorization:RoomAuthorization,ttlMs:number):Promise<boolean>;
  consumeRoom(room:string,match:RoomMatch):Promise<RoomAuthorization|null>;
  revokeRoom(room:string,match:RoomRevocationMatch):Promise<boolean>;
  consumeNonce(nonce:string,ttlMs:number):Promise<boolean>;
  allowRate(key:string,limit:number,windowMs:number):Promise<boolean>;
}

/** Single-process implementation for local tests only. */
export class LocalVoiceSecurityStore implements VoiceSecurityStore {
  private rooms=new Map<string,{authorization:RoomAuthorization;consumed:boolean;revoked:boolean;expiresAt:number}>();
  private nonces=new Map<string,number>();
  private rates=new Map<string,{count:number;expiresAt:number}>();
  constructor(private readonly now:()=>number=Date.now){}
  private prune(){const now=this.now();for(const [key,value] of this.rooms)if(value.expiresAt<=now)this.rooms.delete(key);for(const [key,expiry] of this.nonces)if(expiry<=now)this.nonces.delete(key);for(const [key,value] of this.rates)if(value.expiresAt<=now)this.rates.delete(key)}
  async reserveRoom(room:string,authorization:RoomAuthorization,ttlMs:number){this.prune();if(ttlMs<=0||authorization.expiresAt<=this.now()||this.rooms.has(room)||this.rooms.size>=1000)return false;this.rooms.set(room,{authorization,consumed:false,revoked:false,expiresAt:Math.min(this.now()+ttlMs,authorization.expiresAt)});return true}
  async consumeRoom(room:string,match:RoomMatch){this.prune();const entry=this.rooms.get(room);if(!entry||entry.consumed||entry.revoked)return null;const a=entry.authorization;if(a.organizationId!==match.organizationId||a.agentId!==match.agentId||a.sessionId!==match.sessionId)return null;entry.consumed=true;return a}
  async revokeRoom(room:string,match:RoomRevocationMatch){this.prune();const entry=this.rooms.get(room);if(!entry)return false;const a=entry.authorization;if(a.organizationId!==match.organizationId||a.agentId!==match.agentId||a.sessionId!==match.sessionId||a.userId!==match.userId)return false;entry.revoked=true;return true}
  async consumeNonce(nonce:string,ttlMs:number){this.prune();if(!nonce||ttlMs<=0||this.nonces.has(nonce))return false;this.nonces.set(nonce,this.now()+ttlMs);return true}
  async allowRate(key:string,limit:number,windowMs:number){this.prune();if(!key||limit<=0||windowMs<=0)return false;const current=this.rates.get(key);if(!current){this.rates.set(key,{count:1,expiresAt:this.now()+windowMs});return true}if(current.count>=limit)return false;current.count++;return true}
}

/** Minimal Redis command contract; inject a trusted *local* client for integration tests. */
export interface RedisCommandClient {sendCommand(args:string[]):Promise<string|number|null>}
const consumeRoomScript=`local v=redis.call('GET',KEYS[1]); if not v then return nil end; local d=cjson.decode(v); if d.consumed or d.revoked or d.authorization.organizationId~=ARGV[1] or d.authorization.agentId~=ARGV[2] or d.authorization.sessionId~=ARGV[3] then return nil end; d.consumed=true; redis.call('SET',KEYS[1],cjson.encode(d),'KEEPTTL'); return v`;
const revokeRoomScript=`local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local d=cjson.decode(v); if d.authorization.organizationId~=ARGV[1] or d.authorization.agentId~=ARGV[2] or d.authorization.sessionId~=ARGV[3] or d.authorization.userId~=ARGV[4] then return 0 end; d.revoked=true; redis.call('SET',KEYS[1],cjson.encode(d),'KEEPTTL'); return 1`;
const rateScript=`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; if n>tonumber(ARGV[2]) then return 0 end; return 1`;
export class RedisVoiceSecurityStore implements VoiceSecurityStore {
  constructor(private readonly client:RedisCommandClient,private readonly prefix="voicepilot:test:"){}
  private key(kind:string,value:string){return `${this.prefix}${kind}:${value}`}
  async reserveRoom(room:string,authorization:RoomAuthorization,ttlMs:number){const remaining=authorization.expiresAt-Date.now();if(!room||!authorization.userId||ttlMs<=0||remaining<=0)return false;return await this.client.sendCommand(["SET",this.key("room",room),JSON.stringify({authorization,consumed:false,revoked:false}),"NX","PX",String(Math.ceil(Math.min(ttlMs,remaining)))])==="OK"}
  async consumeRoom(room:string,match:RoomMatch){const value=await this.client.sendCommand(["EVAL",consumeRoomScript,"1",this.key("room",room),match.organizationId,match.agentId,match.sessionId]);if(typeof value!=="string")return null;const parsed:unknown=JSON.parse(value);if(!parsed||typeof parsed!=="object"||!("authorization" in parsed))throw new Error("Invalid security-store response");const a=(parsed as {authorization:RoomAuthorization}).authorization;if(!a||typeof a.userId!=="string"||!a.userId||typeof a.expiresAt!=="number"||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=Date.now()||a.organizationId!==match.organizationId||a.agentId!==match.agentId||a.sessionId!==match.sessionId)return null;return a}
  async revokeRoom(room:string,match:RoomRevocationMatch){return await this.client.sendCommand(["EVAL",revokeRoomScript,"1",this.key("room",room),match.organizationId,match.agentId,match.sessionId,match.userId])===1}
  async consumeNonce(nonce:string,ttlMs:number){if(!nonce||ttlMs<=0)return false;return await this.client.sendCommand(["SET",this.key("nonce",nonce),"1","NX","PX",String(ttlMs)])==="OK"}
  async allowRate(key:string,limit:number,windowMs:number){if(!key||limit<=0||windowMs<=0)return false;return await this.client.sendCommand(["EVAL",rateScript,"1",this.key("rate",key),String(windowMs),String(limit)])===1}
}

type RedisConnection=import("@/lib/redis-security-client").RedisSecurityConnection;
const localState=globalThis as typeof globalThis & {__voicepilotSecurityStore?:LocalVoiceSecurityStore;__voicepilotRedisConnection?:RedisConnection;__voicepilotRedisOpening?:Promise<RedisConnection|null>;__voicepilotRedisConfigHash?:string};
export function closeVoiceSecurityConnection(){localState.__voicepilotRedisConnection?.close();localState.__voicepilotRedisConnection=undefined;localState.__voicepilotRedisConfigHash=undefined}
/** No production memory fallback. Redis opens only when explicitly configured. */
export async function getVoiceSecurityStore():Promise<VoiceSecurityStore|null> {
  const production=process.env.NODE_ENV==="production";
  const mode=process.env.VOICE_SECURITY_STORE||(production?"disabled":"local");
  if(mode!=="redis"){
    closeVoiceSecurityConnection();
    if(mode==="local"&&!production)return localState.__voicepilotSecurityStore??=new LocalVoiceSecurityStore();
    return null;
  }
  if(!process.env.VOICE_REDIS_URL)return null;
  const prefix=process.env.VOICE_REDIS_PREFIX||(production?"voicepilot:prod:":"voicepilot:local:");
  const configHash=createHash("sha256").update(`${production}:${process.env.VOICE_REDIS_URL}:${prefix}`).digest("hex");
  if(localState.__voicepilotRedisConfigHash&&localState.__voicepilotRedisConfigHash!==configHash)closeVoiceSecurityConnection();
  if(localState.__voicepilotRedisConnection?.isReady())return localState.__voicepilotRedisConnection.store;
  if(!localState.__voicepilotRedisOpening){
    localState.__voicepilotRedisConnection?.close();
    localState.__voicepilotRedisConnection=undefined;
    localState.__voicepilotRedisConfigHash=configHash;
    localState.__voicepilotRedisOpening=(async()=>{
      try{
        const {createRedisSecurityConnection}=await import("@/lib/redis-security-client");
        const connection=await createRedisSecurityConnection(process.env.VOICE_REDIS_URL||"",prefix,production);
        localState.__voicepilotRedisConnection=connection;
        return connection;
      }catch{return null}
    })();
  }
  try{return (await localState.__voicepilotRedisOpening)?.store||null}
  finally{localState.__voicepilotRedisOpening=undefined}
}
