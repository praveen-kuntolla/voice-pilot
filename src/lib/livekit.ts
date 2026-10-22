export type VoiceRuntimeConfig = {organizationId:string;agentId:string;language:string;voiceId?:string;instructions:string;knowledgeSourceIds:string[]};

export const livekitFlags = {
  mockMode: process.env.NEXT_PUBLIC_VOICE_MOCK_MODE !== "false",
  realtimeEnabled: process.env.VOICE_REALTIME_ENABLED === "true",
  connectivityTestEnabled: process.env.VOICE_CONNECTIVITY_TEST_ENABLED === "true",
  outboundCallingEnabled: process.env.VOICE_OUTBOUND_ENABLED === "true",
};

export type LiveKitMode = "connectivity" | "realtime";
export type LiveKitConfiguration = {mode:LiveKitMode;url:string;apiKey:string;apiSecret:string};

function secureLiveKitUrl(raw: string | undefined): URL {
  if (!raw) throw new Error("LiveKit URL is missing");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("LiveKit URL is invalid"); }
  if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("LiveKit URL must be a secure WebSocket origin");
  }
  return url;
}

export function getLiveKitConfiguration(env: Record<string,string|undefined> = process.env): LiveKitConfiguration {
  const connectivity = env.VOICE_CONNECTIVITY_TEST_ENABLED === "true";
  const realtime = env.VOICE_REALTIME_ENABLED === "true";
  if (connectivity === realtime) throw new Error("Exactly one LiveKit mode must be enabled");
  if (connectivity && env.VOICE_OUTBOUND_ENABLED === "true") throw new Error("Outbound calling is forbidden in connectivity mode");
  if (connectivity && env.VOICE_PROVIDER_MODE !== "mock") throw new Error("Connectivity mode requires mock provider mode");
  const serverUrl = secureLiveKitUrl(env.LIVEKIT_URL);
  const browserUrl = secureLiveKitUrl(env.NEXT_PUBLIC_LIVEKIT_URL);
  if (serverUrl.origin !== browserUrl.origin) throw new Error("LiveKit server and browser URLs differ");
  if (connectivity && (!env.LIVEKIT_TEST_PROJECT_HOST || serverUrl.hostname !== env.LIVEKIT_TEST_PROJECT_HOST.toLowerCase())) {
    throw new Error("LiveKit test project host does not match");
  }
  if (connectivity && env.NODE_ENV === "production") throw new Error("Connectivity mode is local-only");
  if (connectivity) {
    let supabaseUrl: URL;
    try { supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL || ""); }
    catch { throw new Error("Connectivity mode requires local Supabase"); }
    if (!["127.0.0.1","localhost"].includes(supabaseUrl.hostname)) throw new Error("Connectivity mode requires local Supabase");
  }
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) throw new Error("LiveKit server credentials are incomplete");
  return {mode: connectivity ? "connectivity" : "realtime", url: browserUrl.origin, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET};
}

export function canCreateRealtimeSession(): boolean {
  try { return getLiveKitConfiguration().mode === "realtime"; } catch { return false; }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function voiceRoomName(organizationId: string, agentId: string, sessionId:string): string {
  if (![organizationId,agentId,sessionId].every(value=>uuid.test(value))) throw new Error("Invalid room identity");
  return `voicepilot:${organizationId}:${agentId}:${sessionId}`;
}
export function parseVoiceRoomName(room:string){
  const parts=room.split(":");
  if(parts.length!==4||parts[0]!=="voicepilot")throw new Error("Invalid room identity");
  const [,organizationId,agentId,sessionId]=parts;
  if(room!==voiceRoomName(organizationId,agentId,sessionId))throw new Error("Invalid room identity");
  return {organizationId,agentId,sessionId};
}

export async function createLiveKitToken(input: {identity:string;room:string}, config = getLiveKitConfiguration()): Promise<string> {
  parseVoiceRoomName(input.room);
  if (!input.identity) throw new Error("Invalid LiveKit participant or room");
  const {AccessToken} = await import("livekit-server-sdk");
  const token = new AccessToken(config.apiKey, config.apiSecret, {identity:input.identity, ttl:300});
  token.addGrant({roomJoin:true, room:input.room, canPublish:config.mode === "realtime", canSubscribe:true, canPublishData:false});
  return token.toJwt();
}
