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

export function getOfflineVoiceProfile(id: string) {
  return OFFLINE_VOICE_PROFILES.find((profile) => profile.id === id);
}

export function buildOfflineVoicePreview(profileId: string, sample: string, agentLanguage = "en-US") {
  const profile = getOfflineVoiceProfile(profileId);
  const text = sample.trim();
  if (!profile) return { ok: false as const, error: "Select an offline voice profile." };
  if (!text) return { ok: false as const, error: "Enter sample text for the simulated preview." };
  if (text.length > MAX_PREVIEW_CHARACTERS) return { ok: false as const, error: `Preview text must be ${MAX_PREVIEW_CHARACTERS} characters or fewer.` };
  if (profile.language.split("-")[0] !== agentLanguage.split("-")[0]) return { ok: false as const, error: "This offline voice profile does not match the agent language." };
  return { ok: true as const, value: { profileId: profile.id, profileName: profile.name, language: profile.language, sample: text, label: "SIMULATION ONLY" as const } };
}
