import { voiceProfileLanguageStatus, voiceProfileState } from "@/lib/voice-profile";

export type OfflineEvaluationInput = {
  instructions?: string | null;
  language?: string | null;
  voiceId?: string | null;
  simulationState: string;
  turns: number;
  preflightAllowed: boolean;
};

export function evaluateOfflineAgent(input: OfflineEvaluationInput) {
  const warnings: string[] = [];
  if (!input.instructions?.trim()) warnings.push("System instructions are missing.");
  if (voiceProfileState(input.voiceId) === "unsupported") warnings.push("The saved voice profile is not available for offline preview.");
  if (voiceProfileLanguageStatus(input.voiceId, input.language) === "language-review") warnings.push("The mock voice and agent language need compatibility review.");
  if (!input.preflightAllowed) warnings.push("Server preflight was not authorized.");
  if (["failed", "interrupted"].includes(input.simulationState)) warnings.push(`Simulation ${input.simulationState}; reset before starting a new evaluation.`);
  if (input.simulationState === "idle" && input.turns === 0) warnings.push("No synthetic conversation has been evaluated yet.");
  return { synthetic: true as const, ruleBased: true as const, state: input.simulationState, turns: input.turns, warnings };
}
