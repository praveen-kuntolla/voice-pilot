import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { evaluateOfflineAgent } from "@/lib/offline-agent-evaluation";

type Props = { agent?: { name: string; language?: string | null; voice?: string | null; instructions?: string | null }; scenario?: string; state: string; turns: number; preflightAllowed: boolean; exportEligible: boolean; onReset: () => void };

export function OfflineAgentEvaluationPanel({ agent, scenario = "No scenario selected", state, turns, preflightAllowed, exportEligible, onReset }: Props) {
  const evaluation = evaluateOfflineAgent({ instructions: agent?.instructions, language: agent?.language, voiceId: agent?.voice, simulationState: state, turns, preflightAllowed });
  return <section className="card" aria-label="Offline evaluation" style={{ marginTop: 18 }}>
    <div className="eyebrow">Evaluation · rule-based synthetic review</div>
    <h2>Offline evaluation</h2>
    {!agent ? <p className="muted">Select an authorized agent to review its configuration and run a synthetic scenario.</p> : <>
      <div className="grid"><div><span className="muted">Scenario</span><strong>{scenario}</strong></div><div><span className="muted">Turns</span><strong>{turns}</strong></div><div><span className="muted">State</span><strong>{state}</strong></div></div>
      <p className="muted">Agent: {agent.name} · {agent.language || "Language unavailable"} · {agent.voice || "No mock voice assigned"}</p>
      <p className="muted">Transcript export: {exportEligible ? "eligible after review" : "blocked until authorized synthetic activity exists"}</p>
      {evaluation.warnings.length ? <div role="alert"><strong><AlertTriangle size={15} /> Review warnings</strong><ul>{evaluation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : <p className="muted"><CheckCircle2 size={15} /> No deterministic configuration warnings.</p>}
      <button className="btn ghost" type="button" onClick={onReset}><RotateCcw size={15} /> Reset evaluation</button>
    </>}
  </section>;
}
