import {parseVoiceRoomName} from "@/lib/livekit";
import {getVoiceSecurityStore,type RoomAuthorization} from "@/lib/voice-security-store";

const ROOM_TTL_MS=5*60*1000;

/** Issuance is single-use, short-lived, and never falls back on store failure. */
export async function registerIssuedRoom(room:string,organizationId:string,agentId:string,userId:string,sessionId:string,now=Date.now()):Promise<boolean>{
  const parsed=parseVoiceRoomName(room);
  if(parsed.organizationId!==organizationId||parsed.agentId!==agentId||parsed.sessionId!==sessionId||!userId)return false;
  const store=await getVoiceSecurityStore();
  if(!store)return false;
  const authorization:RoomAuthorization={organizationId,agentId,userId,sessionId,expiresAt:now+ROOM_TTL_MS};
  try{return await store.reserveRoom(room,authorization,ROOM_TTL_MS)}catch{return false}
}

export async function consumeIssuedRoom(room:string,organizationId:string,agentId:string,sessionId:string):Promise<RoomAuthorization|null>{
  const parsed=parseVoiceRoomName(room);
  if(parsed.organizationId!==organizationId||parsed.agentId!==agentId||parsed.sessionId!==sessionId)return null;
  const store=await getVoiceSecurityStore();
  if(!store)return null;
  return store.consumeRoom(room,{organizationId,agentId,sessionId});
}

/** Local application-level revocation; does not invalidate an issued LiveKit JWT. */
export async function revokeIssuedRoom(room:string,organizationId:string,agentId:string,sessionId:string,userId:string):Promise<boolean>{
  const parsed=parseVoiceRoomName(room);
  if(parsed.organizationId!==organizationId||parsed.agentId!==agentId||parsed.sessionId!==sessionId||!userId)return false;
  const store=await getVoiceSecurityStore();
  if(!store)throw new Error("Security store unavailable");
  return store.revokeRoom(room,{organizationId,agentId,sessionId,userId});
}
