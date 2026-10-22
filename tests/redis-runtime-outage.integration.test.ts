import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {describe,expect,it} from "vitest";
import {createRedisSecurityConnection} from "@/lib/redis-security-client";

const suite=process.env.VOICE_TEST_REDIS_RUNTIME_OUTAGE==="true"?describe:describe.skip;
const container="voicepilot-ai-redis-test";
suite("established local Redis connection outage",()=>{
  it("times out a command, fails closed, unpauses and recovers",async()=>{
    const url=process.env.VOICE_TEST_REDIS_URL||"";
    const ports=JSON.parse(execFileSync("docker",["inspect","--format","{{json .NetworkSettings.Ports}}",container],{encoding:"utf8"}));
    expect(ports["6379/tcp"]).toEqual([{HostIp:"127.0.0.1",HostPort:"16379"}]);
    const prefix=`voicepilot:test:${randomUUID()}:`;
    const connection=await createRedisSecurityConnection(url,prefix);
    expect(await connection.store.consumeNonce("before-runtime-outage",30000)).toBe(true);
    execFileSync("docker",["pause",container],{stdio:"ignore"});
    try{
      await expect(connection.store.consumeNonce("during-runtime-outage",30000)).rejects.toThrow(/unavailable/);
    }finally{
      execFileSync("docker",["unpause",container],{stdio:"ignore"});
      connection.close();
    }
    const recovered=await createRedisSecurityConnection(url,prefix);
    try{
      expect(await recovered.store.consumeNonce("after-runtime-recovery",30000)).toBe(true);
      expect(await recovered.store.consumeNonce("before-runtime-outage",30000)).toBe(false);
    }finally{recovered.close()}
  },15000);
});
