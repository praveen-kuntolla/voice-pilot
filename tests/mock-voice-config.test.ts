import { describe, expect, it } from "vitest";
import {
  MOCK_SPEAKING_RATE_HINTS,
  MOCK_STYLE_NOTE_CHARACTERS,
  buildMockVoiceConfig,
  buildOfflineVoicePreview,
  getOfflineVoiceProfile,
  isProfileLanguageCompatible,
} from "@/lib/voice-profiles";
import { mockVoiceSessionLabel, runtimeConfigSchema } from "@/lib/voice-runtime";

describe("buildMockVoiceConfig", () => {
  it("accepts a valid configuration with defaults", () => {
    const result = buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "en-US" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      profileId: "mock-calm-en",
      profileName: "Calm English",
      language: "en-US",
      agentLanguage: "en-US",
      speakingRateHint: "normal",
      styleNote: "",
      label: "SIMULATION ONLY",
    });
  });

  it("accepts every speaking-rate hint and the en-GB profile with a matching agent language", () => {
    for (const hint of MOCK_SPEAKING_RATE_HINTS) {
      const result = buildMockVoiceConfig({ profileId: "mock-clear-en", agentLanguage: "en-GB", speakingRateHint: hint, styleNote: "  Steady pace.  " });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.speakingRateHint).toBe(hint);
        expect(result.value.styleNote).toBe("Steady pace.");
      }
    }
  });

  it("rejects unsupported profile ids", () => {
    const result = buildMockVoiceConfig({ profileId: "does-not-exist", agentLanguage: "en-US" });
    expect(result).toEqual({ ok: false, error: "Select an offline voice profile." });
  });

  it("rejects provider-style profile ids rather than pretending they are mock profiles", () => {
    expect(buildMockVoiceConfig({ profileId: "twilio-alice", agentLanguage: "en-US" }).ok).toBe(false);
    expect(buildMockVoiceConfig({ profileId: "safe-demo", agentLanguage: "en-US" }).ok).toBe(false);
  });

  it("rejects empty and malformed agent languages", () => {
    expect(buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "  " }).ok).toBe(false);
    expect(buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "not a language!" }).ok).toBe(false);
    expect(buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "e".repeat(36) }).ok).toBe(false);
  });

  it("rejects language mismatches deterministically", () => {
    expect(buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "fr-FR" })).toEqual({
      ok: false,
      error: "This offline voice profile does not match the agent language.",
    });
    expect(buildMockVoiceConfig({ profileId: "mock-clear-en", agentLanguage: "en-GB" }).ok).toBe(true);
    expect(buildMockVoiceConfig({ profileId: "mock-clear-en", agentLanguage: "fr-CA" }).ok).toBe(false);
  });

  it("enforces the style-note length limit and control-character rejection", () => {
    const tooLong = buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "en-US", styleNote: "a".repeat(MOCK_STYLE_NOTE_CHARACTERS + 1) });
    expect(tooLong.ok).toBe(false);
    const control = buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "en-US", styleNote: "ok\u0007bell" });
    expect(control.ok).toBe(false);
  });

  it("rejects unknown speaking-rate hints", () => {
    expect(buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "en-US", speakingRateHint: "chipmunk" }).ok).toBe(false);
    expect(buildMockVoiceConfig({ profileId: "mock-calm-en", agentLanguage: "en-US", speakingRateHint: "" }).ok).toBe(false);
  });

  it("is deterministic for identical inputs and produces no persistence or provider fields", () => {
    const first = buildMockVoiceConfig({ profileId: "mock-warm-en", agentLanguage: "en-US", styleNote: "Friendly" });
    const second = buildMockVoiceConfig({ profileId: "mock-warm-en", agentLanguage: "en-US", styleNote: "Friendly" });
    expect(first).toEqual(second);
    if (first.ok) {
      expect(Object.keys(first.value).sort()).toEqual(["agentLanguage", "label", "language", "profileId", "profileName", "speakingRateHint", "styleNote"]);
    }
  });
});

describe("shared language compatibility", () => {
  it("matches on base language only", () => {
    expect(isProfileLanguageCompatible("en-US", "en-GB")).toBe(true);
    expect(isProfileLanguageCompatible("en-US", "fr-FR")).toBe(false);
  });

  it("keeps the existing preview behavior intact", () => {
    expect(buildOfflineVoicePreview("mock-clear-en", "Sample.", "en-GB").ok).toBe(true);
    expect(buildOfflineVoicePreview("mock-clear-en", "Sample.", "fr-FR").ok).toBe(false);
    expect(getOfflineVoiceProfile("mock-warm-en")?.language).toBe("en-US");
  });
});

describe("runtime mock voice label (pure, descriptive only)", () => {
  it("labels a supplied ephemeral mock voice deterministically", () => {
    expect(mockVoiceSessionLabel({ mockVoiceLabel: "Warm English" })).toBe("Warm English (simulation label only)");
  });

  it("falls back to a neutral label when none is supplied", () => {
    expect(mockVoiceSessionLabel({})).toBe("Mock voice");
  });

  it("accepts a bounded mockVoiceLabel in the runtime config schema without changing provider defaults", () => {
    const config = runtimeConfigSchema.parse({
      organizationId: "0f0e0d0c-9bbb-4ccc-8ddd-444455556666",
      agentId: "0f0e0d0c-9bbb-4ccc-8ddd-777788889999",
      language: "en-US",
      instructions: "Local simulation only",
      knowledgeSourceIds: [],
      mockVoiceLabel: "Calm English",
      providers: { stt: "mock", llm: "mock", tts: "mock" },
    });
    expect(config.mockVoiceLabel).toBe("Calm English");
    expect(config.providers).toEqual({ stt: "mock", llm: "mock", tts: "mock" });
  });

  it("rejects blank or oversized labels", () => {
    const base = {
      organizationId: "0f0e0d0c-9bbb-4ccc-8ddd-444455556666",
      agentId: "0f0e0d0c-9bbb-4ccc-8ddd-777788889999",
      language: "en-US",
      instructions: "Local simulation only",
      knowledgeSourceIds: [],
    };
    expect(runtimeConfigSchema.safeParse({ ...base, mockVoiceLabel: "   " }).success).toBe(false);
    expect(runtimeConfigSchema.safeParse({ ...base, mockVoiceLabel: "x".repeat(121) }).success).toBe(false);
  });
});
