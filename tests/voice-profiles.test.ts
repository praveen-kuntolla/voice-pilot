import { describe, expect, it } from "vitest";
import { buildOfflineVoicePreview, getOfflineVoiceProfile, OFFLINE_VOICE_PROFILES } from "@/lib/voice-profiles";

describe("offline voice profiles", () => {
  it("provides stable synthetic profiles without provider identifiers", () => {
    expect(OFFLINE_VOICE_PROFILES.map((profile) => profile.id)).toEqual(["mock-calm-en", "mock-warm-en", "mock-clear-en"]);
    expect(getOfflineVoiceProfile("missing")).toBeUndefined();
    expect(OFFLINE_VOICE_PROFILES.every((profile) => profile.id.startsWith("mock-"))).toBe(true);
  });

  it("builds deterministic text-only previews for a matching language", () => {
    expect(buildOfflineVoicePreview("mock-calm-en", " Hello synthetic customer. ", "en-US")).toEqual({
      ok: true,
      value: { profileId: "mock-calm-en", profileName: "Calm English", language: "en-US", sample: "Hello synthetic customer.", label: "SIMULATION ONLY" },
    });
  });

  it("rejects missing, oversized, and mismatched preview input", () => {
    expect(buildOfflineVoicePreview("missing", "hello")).toMatchObject({ ok: false });
    expect(buildOfflineVoicePreview("mock-calm-en", "   ")).toMatchObject({ ok: false });
    expect(buildOfflineVoicePreview("mock-calm-en", "x".repeat(241))).toMatchObject({ ok: false });
    expect(buildOfflineVoicePreview("mock-clear-en", "hello", "fr-FR")).toMatchObject({ ok: false });
  });
});
