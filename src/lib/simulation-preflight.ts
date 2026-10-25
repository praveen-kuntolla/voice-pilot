import type { ProviderPolicySnapshot } from "@/lib/provider-governance";

export type PreflightCheck = { id: string; passed: boolean; message: string };
export type SimulationPreflight = { allowed: boolean; checks: PreflightCheck[] };

export function evaluateMockSimulationPreflight(input: {
  agent: { id: string; organization_id: string; name: string; instructions: string | null; language: string | null; status: string };
  organizationId: string;
  policy: ProviderPolicySnapshot;
}): SimulationPreflight {
  const { agent, organizationId, policy } = input;
  const checks: PreflightCheck[] = [
    { id: "tenant", passed: agent.organization_id === organizationId && policy.organizationId === organizationId && policy.agentId === agent.id, message: "Agent is scoped to the selected organization." },
    { id: "agent", passed: agent.status !== "archived" && Boolean(agent.name.trim()) && Boolean(agent.instructions?.trim()) && Boolean(agent.language?.trim()), message: "Agent configuration is complete and not archived." },
    { id: "provider", passed: true, message: "Mock provider selected; no external provider approval or credential is used." },
    { id: "quota", passed: true, message: "Mock simulation has zero provider usage and does not reserve a provider session." },
    { id: "privacy", passed: true, message: policy.privacy?.consent_required ? "Text entered by the signed-in user remains local to this simulated session." : "No external audio, transcript, or provider processing is used." },
  ];
  return { allowed: checks.every((check) => check.passed), checks };
}
