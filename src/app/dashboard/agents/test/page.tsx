"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Play, RotateCcw, ShieldCheck } from "lucide-react";
import {
  LocalConversationController,
  getSimulationPreset,
  runtimeConfigSchema,
  simulationPresets,
  type SimulationMode,
  type VoiceEvent,
} from "@/lib/voice-runtime";
import { redactTranscriptLines } from "@/lib/transcript-redaction";

type Agent = { id: string; name: string; description?: string | null; instructions?: string | null; language?: string | null; voice?: string | null; status?: string | null };
type Preflight = { allowed?: boolean; organizationId?: string; agentId?: string; checks?: Array<{ id: string; passed: boolean; message: string }>; error?: string };
const activeStates = new Set(["listening", "transcribing", "thinking", "speaking"]);

export default function AgentTest() {
  const [agents, setAgents] = useState<Agent[]>([]), [search, setSearch] = useState(""), [agentId, setAgentId] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(true), [loadError, setLoadError] = useState(""), [preflight, setPreflight] = useState<Preflight | null>(null);
  const [simulationState, setSimulationState] = useState("idle"), [simulationMode, setSimulationMode] = useState<SimulationMode>("success");
  const [simulatedSpeech, setSimulatedSpeech] = useState("Hello, I need help with my account."), [events, setEvents] = useState<VoiceEvent[]>([]), [error, setError] = useState("");
  const [controller, setController] = useState<LocalConversationController | null>(null), [presetId, setPresetId] = useState(""), [presetTurn, setPresetTurn] = useState(0);
  const [exportPreview, setExportPreview] = useState(""), [exportFormat, setExportFormat] = useState<"txt" | "json">("txt"), [reviewed, setReviewed] = useState(false);
  const generationRef = useRef(0), preflightAbortRef = useRef<AbortController | null>(null), controllerRef = useRef<LocalConversationController | null>(null), mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    fetch("/api/agents", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { agents?: Agent[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load agents.");
      if (mountedRef.current && generation === generationRef.current) setAgents(body.agents ?? []);
    }).catch((cause: unknown) => { if (mountedRef.current && generation === generationRef.current) setLoadError(cause instanceof Error ? cause.message : "Unable to load agents."); })
      .finally(() => { if (mountedRef.current && generation === generationRef.current) setLoadingAgents(false); });
    return () => { mountedRef.current = false; generationRef.current++; preflightAbortRef.current?.abort(); controllerRef.current?.end(); controllerRef.current = null; };
  }, []);

  const visibleAgents = useMemo(() => agents.filter((agent) => agent.name.toLowerCase().includes(search.toLowerCase())), [agents, search]);
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const isActive = activeStates.has(simulationState);
  const nextPreset = getSimulationPreset(presetId);

  function syncController(value: LocalConversationController) { if (!mountedRef.current) return; setController(value); setSimulationState(value.state); setEvents([...value.events]); }
  function reset() { generationRef.current++; preflightAbortRef.current?.abort(); preflightAbortRef.current = null; controllerRef.current?.end(); controllerRef.current = null; setController(null); setPreflight(null); setSimulationState("idle"); setEvents([]); setError(""); setExportPreview(""); setReviewed(false); setPresetTurn(0); }
  function chooseAgent(value: string) { reset(); setAgentId(value); }
  function loadPreset() { const preset = getSimulationPreset(presetId); if (!preset) return; reset(); setSimulationMode(preset.mode); setPresetTurn(0); setSimulatedSpeech(preset.turns[0] ?? ""); }
  function loadNextPresetTurn() { if (!nextPreset || presetTurn + 1 >= nextPreset.turns.length) return; const next = presetTurn + 1; setPresetTurn(next); setSimulatedSpeech(nextPreset.turns[next]); }

  async function runSimulation() {
    const agent = selectedAgent;
    if (!agent) { setError("Select an agent before starting a simulation."); return; }
    const generation = ++generationRef.current;
    preflightAbortRef.current?.abort();
    const abort = new AbortController(); preflightAbortRef.current = abort;
    setError(""); setExportPreview(""); setReviewed(false); setSimulationState("preflighting");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/simulation-preflight`, { cache: "no-store", signal: abort.signal });
      const result = await response.json() as Preflight;
      if (!mountedRef.current || generation !== generationRef.current || abort.signal.aborted) return;
      setPreflight(result);
      if (!response.ok || !result.allowed || result.agentId !== agent.id || !result.organizationId) throw new Error(result.error ?? "Simulation blocked by policy preflight.");
      let nextController = controllerRef.current;
      if (!nextController) {
        const config = runtimeConfigSchema.parse({ organizationId: result.organizationId, agentId: agent.id, language: agent.language || "en-US", instructions: agent.instructions || "Local simulation only", knowledgeSourceIds: [], providers: { stt: "mock", llm: "mock", tts: "mock" } });
        nextController = new LocalConversationController(config); controllerRef.current = nextController;
      } else if (nextController.config.agentId !== agent.id || nextController.config.organizationId !== result.organizationId) {
        throw new Error("The selected agent or organization changed; reset and preflight again.");
      }
      if (generation !== generationRef.current || abort.signal.aborted || controllerRef.current !== nextController) return;
      setController(nextController); setSimulationState("listening");
      await nextController.runSimulatedTurn(simulatedSpeech, simulationMode);
      if (!mountedRef.current || generation !== generationRef.current || abort.signal.aborted || controllerRef.current !== nextController) return;
      syncController(nextController);
      if (nextController.state === "failed") setError(nextController.events.at(-1)?.text ?? "The mock provider failed.");
    } catch (cause: unknown) {
      if (abort.signal.aborted || generation !== generationRef.current || !mountedRef.current) return;
      setSimulationState("failed"); setError(cause instanceof Error ? cause.message : "Simulation failed.");
    } finally { if (preflightAbortRef.current === abort) preflightAbortRef.current = null; }
  }

  function eventLines() { return events.map((event) => `Turn ${event.turnId} · [${event.state}/${event.kind}] ${event.text}`).filter(Boolean); }
  function buildExport(format: "txt" | "json") {
    if (!selectedAgent || !preflight) return "";
    const safeAgent = redactTranscriptLines([selectedAgent.name])[0], safeChecks = (preflight.checks ?? []).map((check) => ({ ...check, message: redactTranscriptLines([check.message])[0] })), safeEvents = redactTranscriptLines(eventLines());
    const payload = { simulationOnly: true, label: "SIMULATION ONLY — NO AUDIO / NO LIVE PROVIDERS", exportedAt: new Date().toISOString(), agent: safeAgent, preflight: safeChecks, events: safeEvents, privacyNotice: "Best-effort redaction applied locally; review before sharing." };
    return format === "json" ? JSON.stringify(payload, null, 2) : ["SIMULATION ONLY — NO AUDIO / NO LIVE PROVIDERS", `Agent: ${payload.agent}`, `Exported: ${payload.exportedAt}`, payload.privacyNotice, "Policy preflight:", ...payload.preflight.map((check) => `- ${check.passed ? "PASS" : "BLOCK"}: ${check.message}`), "Conversation events:", ...safeEvents].join("\n");
  }
  function previewExport(format: "txt" | "json") { setExportFormat(format); setExportPreview(buildExport(format)); setReviewed(false); }
  function downloadExport() { if (!reviewed && !window.confirm("Review the redacted preview before downloading. Continue?")) return; if (!exportPreview || !selectedAgent) return; const blob = new Blob([exportPreview], { type: exportFormat === "json" ? "application/json" : "text/plain" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `simulation-${selectedAgent.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${exportFormat}`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }
  function interrupt() { const value = controllerRef.current; if (value?.interrupt()) syncController(value); }
  function end() { const value = controllerRef.current; if (value) { value.end(); syncController(value); } }

  return <main className="main container"><Link className="muted" href="/dashboard/agents">← Back to agents</Link><div className="section" style={{ paddingTop: 32 }}><div className="eyebrow">AI Agent Testing Studio · simulation only</div><h1>Test an agent safely.</h1><p className="muted">SIMULATION ONLY — NO AUDIO / NO LIVE PROVIDERS. This studio uses deterministic local responses and never captures a microphone, contacts providers, joins LiveKit or creates usage.</p><div className="notice" style={{ marginTop: 20 }}><ShieldCheck size={16} /> Realtime, worker activation, provider calls and outbound calling are disabled.</div><div className="grid" style={{ gridTemplateColumns: "minmax(240px, 0.8fr) minmax(320px, 1.2fr)", gap: 18, marginTop: 20 }}><section className="card"><h2>Choose an agent</h2><p className="muted">Only agents returned for your selected organization are available.</p><input className="input" aria-label="Search agents" placeholder="Search by name" value={search} onChange={(event) => setSearch(event.target.value)} />{loadingAgents && <p className="muted">Loading agents…</p>}{loadError && <p style={{ color: "#fca5a5" }}>{loadError}</p>}{!loadingAgents && !loadError && !agents.length && <p className="muted">No agents are available for this organization.</p>}{visibleAgents.length > 0 && <select className="input" aria-label="Simulation agent" value={agentId} onChange={(event) => chooseAgent(event.target.value)} style={{ marginTop: 10 }}><option value="">Select an agent</option>{visibleAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.status ?? "draft"}</option>)}</select>}{selectedAgent && <div style={{ marginTop: 16 }}><h3>{selectedAgent.name}</h3><p className="muted">{selectedAgent.description || "No description provided."}</p><p><strong>Language:</strong> {selectedAgent.language || "Not configured"}</p><p><strong>Voice:</strong> {selectedAgent.voice || "Mock voice"}</p><p><strong>Status:</strong> {selectedAgent.status || "draft"}</p><details><summary>Instructions preview</summary><p className="muted">{selectedAgent.instructions || "No instructions configured."}</p></details></div>}</section><section className="card"><h2>Simulation console</h2>{!selectedAgent && <p className="muted">Select an agent to begin a server-verified preflight.</p>}{selectedAgent && <><label className="muted" htmlFor="scenario-preset">Synthetic scenario preset</label><div style={{ display: "flex", gap: 8, marginTop: 8 }}><select id="scenario-preset" className="input" aria-label="Synthetic scenario preset" value={presetId} onChange={(event) => setPresetId(event.target.value)}><option value="">Choose a preset</option>{simulationPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><button className="btn ghost" onClick={loadPreset} disabled={!presetId || isActive}>Load preset</button></div>{nextPreset && <p className="muted">{nextPreset.description} · turn {Math.min(presetTurn + 1, nextPreset.turns.length)} of {nextPreset.turns.length}</p>}<label className="muted" htmlFor="simulated-speech">Sample customer message</label><textarea id="simulated-speech" className="input" value={simulatedSpeech} maxLength={1000} onChange={(event) => setSimulatedSpeech(event.target.value)} style={{ marginTop: 8, minHeight: 100 }} /><select className="input" aria-label="Simulation outcome" value={simulationMode} onChange={(event) => setSimulationMode(event.target.value as SimulationMode)} style={{ marginTop: 10 }}><option value="success">Successful response</option><option value="slow">Slow response</option><option value="error">Provider failure</option><option value="empty">Empty output</option></select><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button className="btn primary" onClick={runSimulation} disabled={simulationState === "preflighting" || isActive || simulationState === "ended"}><Play size={16} /> Run simulation</button><button className="btn ghost" onClick={loadNextPresetTurn} disabled={!nextPreset || presetTurn + 1 >= nextPreset.turns.length || isActive}>Next preset turn</button><button className="btn ghost" onClick={reset}><RotateCcw size={16} /> Reset</button><button className="btn ghost" onClick={interrupt} disabled={!controller || !isActive}>Interrupt</button><button className="btn ghost" onClick={end} disabled={!controller || simulationState === "ended"}>End</button></div><p role="status" aria-live="polite" style={{ marginTop: 14 }}>State: <strong>{simulationState}</strong> · Turns completed: <strong>{controller?.turnCount ?? 0}</strong> / 8</p></>}{preflight?.checks && <div style={{ marginTop: 14 }}><h3>Policy preflight</h3>{preflight.checks.map((check) => <p key={check.id} className="muted">{check.passed ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {check.message}</p>)}</div>}{error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}<div className="card" style={{ marginTop: 18 }}><h3>Conversation history</h3>{events.length ? events.map((event) => <p className="muted" key={`${event.sequence}-${event.turnId}`}>Turn {event.turnId} · [{event.state}/{event.kind}] {event.text}</p>) : <p className="muted">No simulated events yet.</p>}{preflight && events.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button className="btn ghost" onClick={() => previewExport("txt")}>Preview TXT export</button><button className="btn ghost" onClick={() => previewExport("json")}>Preview JSON export</button></div>}{exportPreview && <><p className="muted" style={{ marginTop: 12 }}>Preview is local only. Review for personal information before downloading.</p><pre style={{ maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 12 }}>{exportPreview}</pre><label className="muted"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed this simulation-only export</label><div style={{ display: "flex", gap: 8, marginTop: 8 }}><button className="btn primary" onClick={downloadExport} disabled={!reviewed}>Download reviewed export</button><button className="btn ghost" onClick={() => setExportPreview("")}>Close preview</button></div></>}</div></section></div></div></main>;
}
