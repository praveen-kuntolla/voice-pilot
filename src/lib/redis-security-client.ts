import {createClient} from "redis";
import {RedisVoiceSecurityStore,type RedisCommandClient} from "@/lib/voice-security-store";

export type RedisSecurityConnection={store:RedisVoiceSecurityStore;isReady:()=>boolean;close:()=>void};

/** Explicit connection; local tests may use redis://localhost, production requires TLS. */
export async function createRedisSecurityConnection(urlText:string,prefix:string,production=false):Promise<RedisSecurityConnection>{
  let url:URL;
  try{url=new URL(urlText)}catch{throw new Error("Redis connection configuration is invalid")}
  if(url.hash||url.search||!url.hostname||!/^voicepilot:[a-z0-9:-]{2,80}:$/.test(prefix))throw new Error("Redis connection configuration is invalid");
  if(production){
    if(url.protocol!=="rediss:")throw new Error("Production Redis requires TLS");
  }else if(url.protocol!=="redis:"||!["127.0.0.1","localhost"].includes(url.hostname))throw new Error("Local Redis must use loopback");
  const client=createClient({url:urlText,disableOfflineQueue:true,socket:{connectTimeout:1500,reconnectStrategy:false}});
  // Do not print errors: connection URLs may contain private credentials.
  client.on("error",()=>{});
  let connectTimer:ReturnType<typeof setTimeout>|undefined;
  try{
    await Promise.race([
      client.connect(),
      new Promise<never>((_,reject)=>{connectTimer=setTimeout(()=>reject(new Error("Redis handshake timeout")),2000)}),
    ]);
  }catch{client.destroy();throw new Error("Redis security store unavailable")}
  finally{if(connectTimer)clearTimeout(connectTimer)}
  const commandClient:RedisCommandClient={
    async sendCommand(args){
      if(!client.isReady)throw new Error("Redis security store unavailable");
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        const value=await Promise.race([
          client.sendCommand(args),
          new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Redis security store timeout")),1500)}),
        ]);
        if(value!==null&&typeof value!=="string"&&typeof value!=="number")throw new Error("Invalid Redis security response");
        return value;
      }catch{client.destroy();throw new Error("Redis security store unavailable")}
      finally{if(timer)clearTimeout(timer)}
    },
  };
  return {store:new RedisVoiceSecurityStore(commandClient,prefix),isReady:()=>client.isReady,close:()=>client.destroy()};
}
