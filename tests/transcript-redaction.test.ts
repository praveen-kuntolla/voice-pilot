import { describe, expect, it } from "vitest";
import { redactTranscript } from "@/lib/transcript-redaction";

describe("simulation transcript redaction", () => {
  it("redacts email, phone, bearer token and API-key patterns", () => {
    const result = redactTranscript("Email test@example.com, call +1 (415) 555-0132. Bearer abcdefghijklmnop and sk-test_1234567890.");
    expect(result).not.toContain("test@example.com");
    expect(result).not.toContain("415");
    expect(result).not.toContain("abcdefghijklmnop");
    expect(result).toContain("[REDACTED");
  });
  it("redacts valid payment-card-like numbers but preserves ordinary numbers", () => {
    expect(redactTranscript("Card 4111 1111 1111 1111")).toContain("[REDACTED CARD]");
    expect(redactTranscript("Order 1234567890123")).toContain("1234567890123");
  });
  it("does not claim to redact arbitrary personal information", () => {
    expect(redactTranscript("My name is Alice from Springfield")).toContain("Alice");
  });
});
