import {describe,expect,it} from "vitest";
import {verifyWorkerRequest,workerSignature} from "@/lib/worker-auth";
import {LocalVoiceSecurityStore} from "@/lib/voice-security-store";

describe("worker authentication",()=>{
  const body='{"organization_id":"11111111-1111-4111-8111-111111111111"}';
  const secret="test-secret",path="/api/internal/voice-agent/config";
  it("binds method, path and exact body to a single-use nonce",async()=>{
    const store=new LocalVoiceSecurityStore(),timestamp=String(Date.now()),nonce="nonce-1234567890123456";
    const signature=workerSignature("POST",path,body,timestamp,nonce,secret);
    expect(await verifyWorkerRequest("POST",path,body,timestamp,nonce,signature,secret,Date.now(),store)).toBe(true);
    expect(await verifyWorkerRequest("POST",path,body,timestamp,nonce,signature,secret,Date.now(),store)).toBe(false);
    expect(await verifyWorkerRequest("GET",path,body,timestamp,"nonce-2234567890123456",signature,secret,Date.now(),store)).toBe(false);
  });
  it("rejects stale, future, modified, missing-secret and unavailable-store requests",async()=>{
    const store=new LocalVoiceSecurityStore(),now=Date.now(),nonce="nonce-3234567890123456";
    for(const ts of [String(now-300001),String(now+300001)])expect(await verifyWorkerRequest("POST",path,body,ts,nonce,workerSignature("POST",path,body,ts,nonce,secret),secret,now,store)).toBe(false);
    const ts=String(now),signature=workerSignature("POST",path,body,ts,nonce,secret);
    expect(await verifyWorkerRequest("POST",path,body+"x",ts,nonce,signature,secret,now,store)).toBe(false);
    expect(await verifyWorkerRequest("POST",path,body,ts,nonce,signature,"",now,store)).toBe(false);
    expect(await verifyWorkerRequest("POST",path,body,ts,nonce,signature,secret,now,null)).toBe(false);
    const failedStore={consumeNonce:async()=>{throw new Error("store down")}} as never;
    expect(await verifyWorkerRequest("POST",path,body,ts,nonce,signature,secret,now,failedStore)).toBe(false);
  });
});
