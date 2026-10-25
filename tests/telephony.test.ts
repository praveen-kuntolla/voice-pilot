import { describe, expect, it } from "vitest";
import { assertTelephonyActivationAllowed, telephonyReadiness, validateTelephonyConfig } from "@/lib/telephony";

describe("telephony readiness", () => {
  it("defaults to disabled and fails closed", () => {
    const config = validateTelephonyConfig({});
    expect(config.ok).toBe(true);
    if (config.ok) { expect(telephonyReadiness(config.config)).toBe("disabled"); expect(() => assertTelephonyActivationAllowed(config.config)).toThrow("disabled"); }
  });
  it("rejects mock activation and accepts a diagnostic sandbox configuration", () => {
    expect(validateTelephonyConfig({ provider: "mock", mode: "sandbox" }).ok).toBe(false);
    const config = validateTelephonyConfig({ provider: "twilio", mode: "sandbox", accountReference: "test" });
    expect(config.ok).toBe(true);
  });
  it("rejects production mode at configuration validation", () => { expect(validateTelephonyConfig({ provider: "twilio", mode: "production" }).ok).toBe(false); });
});
