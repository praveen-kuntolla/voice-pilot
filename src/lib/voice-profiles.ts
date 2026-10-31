export type OfflineVoiceProfile = {
  id: string;
  name: string;
  language: string;
  style: string;
  description: string;
};

export type OfflineVoicePreview = {
  profileId: string;
  profileName: string;
  language: string;
  sample: string;
  label: "SIMULATION ONLY";
};

export const OFFLINE_VOICE_PROFILES: readonly OfflineVoiceProfile[] = [
  { id: "mock-calm-en", name: "Calm English", language: "en-US", style: "Calm", description: "A concise, steady synthetic voice profile." },
  { id: "mock-warm-en", name: "Warm English", language: "en-US", style: "Warm", description: "A friendly synthetic voice profile for welcoming scenarios." },
  { id: "mock-clear-en", name: "Clear English", language: "en-GB", style: "Clear", description: "A precise synthetic voice profile for instructional scenarios." },
];

const MAX_PREVIEW_CHARACTERS = 240;

export const MOCK_STYLE_NOTE_CHARACTERS = 160;
export const MOCK_SPEAKING_RATE_HINTS = ["slow", "normal", "fast"] as const;
export type MockSpeakingRateHint = (typeof MOCK_SPEAKING_RATE_HINTS)[number];

export type MockVoiceConfig = {
  profileId: string;
  profileName: string;
  language: string;
  agentLanguage: string;
  speakingRateHint: MockSpeakingRateHint;
  styleNote: string;
  label: "SIMULATION ONLY";
};

export type MockVoiceConfigValidation =
  | { ok: true; value: MockVoiceConfig }
  | { ok: false; error: string };

/** Deterministic base-language compatibility reused by preview and config validation. */
export function isProfileLanguageCompatible(profileLanguage: string, agentLanguage: string) {
  return profileLanguage.split("-")[0] === agentLanguage.split("-")[0];
}

function hasUnsafeControlCharacters(value: string) {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

/**
 * Validates an ephemeral, simulation-only mock voice configuration. No provider,
 * persistence, or audio behavior is described or implied by the result.
 */
export function buildMockVoiceConfig(input: {
  profileId: string;
  agentLanguage: string;
  speakingRateHint?: string;
  styleNote?: string;
}): MockVoiceConfigValidation {
  const profile = getOfflineVoiceProfile(input.profileId);
  if (!profile) return { ok: false, error: "Select an offline voice profile." };
  const agentLanguage = input.agentLanguage.trim();
  if (!agentLanguage) return { ok: false, error: "An agent language is required for compatibility checks." };
  if (agentLanguage.length > 35 || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(agentLanguage)) return { ok: false, error: "The agent language is not a supported language tag." };
  if (!isProfileLanguageCompatible(profile.language, agentLanguage)) return { ok: false, error: "This offline voice profile does not match the agent language." };
  const hint = input.speakingRateHint ?? "normal";
  if (!(MOCK_SPEAKING_RATE_HINTS as readonly string[]).includes(hint)) return { ok: false, error: "The speaking-rate hint must be slow, normal, or fast." };
  const styleNote = (input.styleNote ?? "").trim();
  if (hasUnsafeControlCharacters(styleNote)) return { ok: false, error: "The style note contains unsupported control characters." };
  if (styleNote.length > MOCK_STYLE_NOTE_CHARACTERS) return { ok: false, error: `The style note must be ${MOCK_STYLE_NOTE_CHARACTERS} characters or fewer.` };
  return {
    ok: true,
    value: {
      profileId: profile.id,
      profileName: profile.name,
      language: profile.language,
      agentLanguage,
      speakingRateHint: hint as MockSpeakingRateHint,
      styleNote,
      label: "SIMULATION ONLY" as const,
    },
  };
}

export function getOfflineVoiceProfile(id: string) {
  return OFFLINE_VOICE_PROFILES.find((profile) => profile.id === id);
}

export function buildOfflineVoicePreview(profileId: string, sample: string, agentLanguage = "en-US") {
  const profile = getOfflineVoiceProfile(profileId);
  const text = sample.trim();
  if (!profile) return { ok: false as const, error: "Select an offline voice profile." };
  if (!text) return { ok: false as const, error: "Enter sample text for the simulated preview." };
  if (text.length > MAX_PREVIEW_CHARACTERS) return { ok: false as const, error: `Preview text must be ${MAX_PREVIEW_CHARACTERS} characters or fewer.` };
  if (!isProfileLanguageCompatible(profile.language, agentLanguage)) return { ok: false as const, error: "This offline voice profile does not match the agent language." };
  return { ok: true as const, value: { profileId: profile.id, profileName: profile.name, language: profile.language, sample: text, label: "SIMULATION ONLY" as const } };
}
