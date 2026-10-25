import { describe, expect, it } from "vitest";
import { futureDateTime, resolveLocalDateTime } from "@/lib/scheduling";

describe("simulation scheduling", () => {
  it("validates IANA zones and evaluates the wall clock in that zone", () => {
    expect(resolveLocalDateTime("2030-01-01", "10:00", "Asia/Kolkata").ok).toBe(true);
    expect(resolveLocalDateTime("2030-01-01", "10:00", "Not/A_Timezone").ok).toBe(false);
    expect(futureDateTime("2030-01-01", "10:00", "Asia/Kolkata", Date.parse("2029-12-31T00:00:00Z"))).toBe(true);
    expect(futureDateTime("2030-01-01", "10:00", "Asia/Colombo", Date.parse("2029-12-31T00:00:00Z"))).toBe(true);
  });
  it("rejects malformed, past, and daylight-saving gap times", () => {
    expect(futureDateTime("2020-01-01", "10:00", "UTC", Date.parse("2021-01-01T00:00:00Z"))).toBe(false);
    expect(futureDateTime("2030-02-31", "10:00", "UTC", Date.parse("2029-01-01T00:00:00Z"))).toBe(false);
    expect(futureDateTime("2030-03-10", "02:30", "America/New_York", Date.parse("2029-01-01T00:00:00Z"))).toBe(false);
    expect(futureDateTime("2030-11-03", "01:30", "America/New_York", Date.parse("2029-01-01T00:00:00Z"))).toBe(false);
    expect(futureDateTime("2030-01-01", "10:01", "UTC", Date.parse("2030-01-01T10:01:00Z"))).toBe(false);
  });
});
