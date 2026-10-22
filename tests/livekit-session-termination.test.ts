import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {POST} from "@/app/api/livekit/session/terminate/route";
import {currentMembership} from "@/lib/authz";
import {consumeIssuedRoom,registerIssuedRoom} from "@/lib/livekit-room-auth";
import {voiceRoomName} from "@/lib/livekit";

vi.mock("@/lib/authz",()=>({currentMembership:vi.fn()}));
const org="11111111-1111-4111-8111-111111111111",agent="22222222-2222-4222-8222-222222222222";
function request(room:string){return new Request("http://localhost/api/livekit/session/terminate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({room_name:room})})}
function member(userId:string|null,organizationId=org){vi.mocked(currentMembership).mockResolvedValue({user:userId?{id:userId}:null,membership:userId?{organization_id:organizationId}:null} as never)}

describe("local application-level voice session termination",()=>{
  it("requires authentication and selected-organization membership",async()=>{
    const room=voiceRoomName(org,agent,randomUUID());
    member(null);expect((await POST(request(room))).status).toBe(401);
    member("owner",randomUUID());expect((await POST(request(room))).status).toBe(403);
  });
  it("revokes only the issuing user session and never claims JWT revocation",async()=>{
    const session=randomUUID(),room=voiceRoomName(org,agent,session);
    expect(await registerIssuedRoom(room,org,agent,"owner",session)).toBe(true);
    member("other-user");expect((await POST(request(room))).status).toBe(404);
    member("owner");
    const response=await POST(request(room));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({revoked:true,livekit_jwt_revoked:false});
    expect(await consumeIssuedRoom(room,org,agent,session)).toBeNull();
    expect(await registerIssuedRoom(room,org,agent,"owner",session)).toBe(false);
  });
  it("rejects malformed and extra fields",async()=>{
    member("owner");
    expect((await POST(request("invalid"))).status).toBe(400);
    const req=new Request("http://localhost/api/livekit/session/terminate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({room_name:voiceRoomName(org,agent,randomUUID()),extra:true})});
    expect((await POST(req)).status).toBe(400);
  });
  it("rejects cross-origin and non-JSON browser requests before session lookup",async()=>{
    const room=voiceRoomName(org,agent,randomUUID());
    member("owner");
    vi.mocked(currentMembership).mockClear();
    const crossOrigin=new Request("http://localhost/api/livekit/session/terminate",{method:"POST",headers:{"content-type":"application/json",origin:"https://untrusted.example"},body:JSON.stringify({room_name:room})});
    expect((await POST(crossOrigin)).status).toBe(403);
    const form=new Request("http://localhost/api/livekit/session/terminate",{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify({room_name:room})});
    expect((await POST(form)).status).toBe(415);
    expect(currentMembership).not.toHaveBeenCalled();
  });
});
