import { describe, expect, it } from "vitest";
import { voiceProfileLanguageStatus, voiceProfileState } from "@/lib/voice-profile";

describe("voice profile presentation", () => {
  it("distinguishes missing, supported and unsupported profiles", () => {
    expect(voiceProfileState()).toBe("missing");
    expect(voiceProfileState("safe-demo")).toBe("supported");
    expect(voiceProfileState("provider-only-id")).toBe("unsupported");
  });

  it("checks language compatibility without implying provider availability", () => {
    expect(voiceProfileLanguageStatus("safe-demo", "en-US")).toBe("compatible");
    expect(voiceProfileLanguageStatus("safe-demo", "fr-FR")).toBe("language-review");
    expect(voiceProfileLanguageStatus("provider-only-id", "en-US")).toBe("unavailable");
  });
});
