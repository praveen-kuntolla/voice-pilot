export const SUPPORTED_MOCK_VOICE_ID = "safe-demo";

export type VoiceProfileState = "missing" | "supported" | "unsupported";

export function voiceProfileState(voiceId?: string | null): VoiceProfileState {
  if (!voiceId) return "missing";
  return voiceId === SUPPORTED_MOCK_VOICE_ID ? "supported" : "unsupported";
}

export function voiceProfileLanguageStatus(voiceId: string | null | undefined, language: string | null | undefined) {
  if (voiceProfileState(voiceId) !== "supported") return "unavailable" as const;
  return ["en-US", "en-GB", "hi-IN"].includes(language || "") ? "compatible" as const : "language-review" as const;
}
