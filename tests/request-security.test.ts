import { describe, expect, it } from "vitest";
import { hasSameOrigin } from "@/lib/request-security";

describe("hasSameOrigin", () => {
  it("accepts a loopback request when Next normalizes request.url to localhost", () => {
    const request = new Request("http://localhost:3000/api/governance/quotas", {
      headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    });
    expect(hasSameOrigin(request)).toBe(true);
  });

  it("rejects absent, malformed, and cross-origin mutation requests", () => {
    expect(hasSameOrigin(new Request("http://localhost/api"))).toBe(false);
    expect(hasSameOrigin(new Request("http://localhost/api", { headers: { origin: "not-a-url", host: "localhost" } }))).toBe(false);
    expect(hasSameOrigin(new Request("http://localhost/api", { headers: { origin: "https://evil.example", host: "localhost" } }))).toBe(false);
  });
});
