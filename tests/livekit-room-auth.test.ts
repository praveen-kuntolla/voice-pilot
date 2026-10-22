import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {consumeIssuedRoom,registerIssuedRoom} from "@/lib/livekit-room-auth";
import {voiceRoomName} from "@/lib/livekit";
import {LocalVoiceSecurityStore} from "@/lib/voice-security-store";

const org="11111111-1111-4111-8111-111111111111",agent="22222222-2222-4222-8222-222222222222";

describe("session-scoped room authorization",()=>{
  it("creates unpredictable rooms and consumes only the exact tenant/session once",async()=>{
    const first=randomUUID(),second=randomUUID();
    const room=voiceRoomName(org,agent,first);
    expect(room).not.toBe(voiceRoomName(org,agent,second));
    expect(await registerIssuedRoom(room,org,agent,"browser",first)).toBe(true);
    expect(await consumeIssuedRoom(room,org,agent,second)).toBeNull();
    expect(await consumeIssuedRoom(room,"33333333-3333-4333-8333-333333333333",agent,first)).toBeNull();
    expect((await consumeIssuedRoom(room,org,agent,first))?.userId).toBe("browser");
    expect(await consumeIssuedRoom(room,org,agent,first)).toBeNull();
    expect(await registerIssuedRoom(room,org,agent,"another",first)).toBe(false);
  });
  it("expires authorizations and rejects mismatched agent identity",async()=>{
    let now=1000;
    const store=new LocalVoiceSecurityStore(()=>now),session=randomUUID(),room=voiceRoomName(org,agent,session);
    const authorization={organizationId:org,agentId:agent,userId:"browser",sessionId:session,expiresAt:2000};
    expect(await store.reserveRoom(room,authorization,1000)).toBe(true);
    expect(await store.consumeRoom(room,{organizationId:org,agentId:randomUUID(),sessionId:session})).toBeNull();
    now=2000;
    expect(await store.consumeRoom(room,{organizationId:org,agentId:agent,sessionId:session})).toBeNull();
  });
});
