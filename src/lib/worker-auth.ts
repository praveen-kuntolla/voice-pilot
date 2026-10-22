import {createHmac,timingSafeEqual} from "node:crypto";
import {getVoiceSecurityStore,type VoiceSecurityStore} from "@/lib/voice-security-store";
export function workerSignature(method:string,path:string,body:string,timestamp:string,nonce:string,secret:string){return createHmac("sha256",secret).update(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}`).digest("hex")}
export async function verifyWorkerRequest(method:string,path:string,body:string,timestamp:string,nonce:string,signature:string,secret:string,now=Date.now(),store:VoiceSecurityStore|null|undefined=undefined){
  const activeStore=store===undefined?await getVoiceSecurityStore():store;
  const ts=Number(timestamp);
  if(!activeStore||!secret||!nonce||nonce.length<16||nonce.length>128||!Number.isSafeInteger(ts)||Math.abs(now-ts)>5*60*1000||!/^[a-f0-9]{64}$/i.test(signature))return false;
  const expected=workerSignature(method,path,body,timestamp,nonce,secret);
  if(!timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(signature,"hex")))return false;
  try{return await activeStore.consumeNonce(nonce,5*60*1000)}catch{return false}
}
