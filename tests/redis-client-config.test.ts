import {describe,expect,it} from "vitest";
import {createRedisSecurityConnection} from "@/lib/redis-security-client";

describe("Redis connection safety",()=>{
  it("refuses remote Redis from local development before opening a socket",async()=>{
    await expect(createRedisSecurityConnection("redis://example.invalid:6379","voicepilot:test:")).rejects.toThrow(/loopback/);
  });
  it("requires verified TLS for production Redis",async()=>{
    await expect(createRedisSecurityConnection("redis://127.0.0.1:16379","voicepilot:prod:",true)).rejects.toThrow(/TLS/);
  });
  it("rejects invalid key prefixes",async()=>{
    await expect(createRedisSecurityConnection("redis://127.0.0.1:16379","other-project:")).rejects.toThrow(/invalid/);
  });
});
