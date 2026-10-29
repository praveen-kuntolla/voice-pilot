"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { FileText, Search, Trash2 } from "lucide-react";
import {
  MAX_KNOWLEDGE_QUESTION_CHARACTERS,
  MAX_KNOWLEDGE_SOURCES,
  MAX_SOURCE_CHARACTERS,
  MAX_TOTAL_SOURCE_CHARACTERS,
  NO_MATCHING_EXCERPT,
  KnowledgeFileReadGate,
  retrieveKnowledgeExcerpts,
  validateKnowledgeFile,
  validateKnowledgeQuestion,
  validateKnowledgeSource,
  type KnowledgeExcerpt,
  type KnowledgeSource,
} from "@/lib/knowledge-lab";

type KnowledgeLabProps = {
  /** Derived from the existing server-authoritative Agent Test Studio preflight. */
  authorized: boolean;
  /** Existing preflight is being revalidated; retain no new retrieval action until it completes. */
  busy: boolean;
  /** Changes whenever the parent invalidates or resets its authorized session. */
  sessionKey: number;
  onCopyExcerpt: (excerpt: string) => void;
};

const emptyDraft = { title: "", content: "" };

export function KnowledgeLab({ authorized, busy, sessionKey, onCopyExcerpt }: KnowledgeLabProps) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [matches, setMatches] = useState<KnowledgeExcerpt[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sourceSequence = useRef(0);
  const lastSession = useRef<string | null>(null);
  const sourcesRef = useRef<KnowledgeSource[]>([]);
  const fileReadGate = useRef(new KnowledgeFileReadGate());
  const mountedRef = useRef(true);
  const sessionRef = useRef({ authorized, busy, sessionKey });
  sessionRef.current = { authorized, busy, sessionKey };

  function clearEphemeralKnowledge() {
    fileReadGate.current.invalidate();
    sourcesRef.current = [];
    setSources([]);
    setDraft(emptyDraft);
    setEditingId(null);
    setQuestion("");
    setMatches([]);
    setError("");
    setNotice("");
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fileReadGate.current.invalidate();
    };
  }, []);

  useEffect(() => {
    const identity = `${sessionKey}:${authorized}`;
    if (lastSession.current === identity) return;
    lastSession.current = identity;
    fileReadGate.current.invalidate();
    clearEphemeralKnowledge();
  }, [authorized, sessionKey]);

  const totalCharacters = sources.reduce((total, source) => total + source.content.length, 0);
  const remainingCharacters = MAX_TOTAL_SOURCE_CHARACTERS - totalCharacters;

  function addOrReplaceSource() {
    if (!authorized || busy) {
      setError("A current server-approved simulation preflight is required before using mock sources.");
      return;
    }
    const currentSources = sourcesRef.current;
    const existing = editingId ? currentSources.filter((source) => source.id !== editingId) : currentSources;
    const validation = validateKnowledgeSource(draft, {
      existingCount: existing.length,
      existingCharacterCount: existing.reduce((total, source) => total + source.content.length, 0),
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    fileReadGate.current.invalidate();
    const next = editingId
      ? currentSources.map((source) => source.id === editingId ? { ...validation.value, id: source.id } : source)
      : [...currentSources, { ...validation.value, id: `mock-source-${++sourceSequence.current}` }];
    sourcesRef.current = next;
    setSources(next);
    setDraft(emptyDraft);
    setEditingId(null);
    setMatches([]);
    setNotice("Mock source saved locally for this authorized simulation session only.");
    setError("");
  }

  function editSource(source: KnowledgeSource) {
    fileReadGate.current.invalidate();
    setDraft({ title: source.title, content: source.content });
    setEditingId(source.id);
    setMatches([]);
    setError("");
    setNotice(`Replacing “${source.title}” keeps all content in this browser only.`);
  }

  function removeSource(sourceId: string) {
    fileReadGate.current.invalidate();
    const next = sourcesRef.current.filter((source) => source.id !== sourceId);
    sourcesRef.current = next;
    setSources(next);
    if (editingId === sourceId) {
      setEditingId(null);
      setDraft(emptyDraft);
    }
    setMatches([]);
    setNotice("Mock source removed and prior retrieval excerpts cleared.");
  }

  async function addFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!authorized || busy) {
      setError("A current server-approved simulation preflight is required before reading a mock file.");
      return;
    }
    const fileError = validateKnowledgeFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    const readToken = fileReadGate.current.begin();
    const requestedSession = sessionKey;
    try {
      const content = await file.text();
      const currentSession = sessionRef.current;
      if (!mountedRef.current || !fileReadGate.current.isCurrent(readToken) || !currentSession.authorized || currentSession.busy || currentSession.sessionKey !== requestedSession) return;
      const currentSources = sourcesRef.current;
      const validation = validateKnowledgeSource(
        { title: file.name.replace(/\.(txt|md|markdown)$/i, "") || file.name, content },
        { existingCount: currentSources.length, existingCharacterCount: currentSources.reduce((total, source) => total + source.content.length, 0) },
      );
      if (!validation.ok) {
        setError(validation.error);
        return;
      }
      setDraft(validation.value);
      setEditingId(null);
      setMatches([]);
      setError("");
      setNotice("Local file read into the draft only. Review and save it; no upload occurred.");
    } catch {
      const currentSession = sessionRef.current;
      if (!mountedRef.current || !fileReadGate.current.isCurrent(readToken) || !currentSession.authorized || currentSession.busy || currentSession.sessionKey !== requestedSession) return;
      setError("The local mock file could not be read.");
    }
  }

  function findExcerpts() {
    if (!authorized || busy) {
      setMatches([]);
      setError("A current server-approved simulation preflight is required before retrieval.");
      return;
    }
    const questionError = validateKnowledgeQuestion(question);
    if (questionError) {
      setMatches([]);
      setError(questionError);
      return;
    }
    setMatches(retrieveKnowledgeExcerpts(sources, question));
    setError("");
    setNotice("");
  }

  return <section className="card" aria-labelledby="knowledge-lab-title" style={{ marginTop: 18 }}>
    <div className="eyebrow">Simulation only · browser memory</div>
    <h3 id="knowledge-lab-title">Knowledge Lab</h3>
    <p className="muted">Paste fictional notes or select a local text/Markdown file to preview deterministic, extractive source excerpts. Nothing is uploaded, persisted, logged, added to analytics, or sent to a provider. This is not semantic search or an AI answer. Sources and questions are not exported; an excerpt appears in a separately reviewed transcript only if you explicitly copy it into the mock message and run a turn.</p>
    {!authorized && <p role="status" className="muted">Run a server-approved simulation preflight before adding or retrieving mock sources. Reset, authorization denial, and agent changes clear this panel.</p>}
    {authorized && <>
      {busy && <p role="status" className="muted">Authorization is being revalidated. Mock source actions are temporarily disabled.</p>}
      <div className="grid" style={{ gridTemplateColumns: "minmax(240px, 1fr) minmax(280px, 1.2fr)", gap: 14, marginTop: 12 }}>
        <div>
          <label className="muted" htmlFor="knowledge-source-title">Mock source title</label>
          <input id="knowledge-source-title" className="input" value={draft.title} maxLength={120} placeholder="Fictional product notes" onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
          <label className="muted" htmlFor="knowledge-source-content" style={{ display: "block", marginTop: 10 }}>Paste mock text or Markdown</label>
          <textarea id="knowledge-source-content" className="input" value={draft.content} maxLength={MAX_SOURCE_CHARACTERS + 1} placeholder="Synthetic notes only — no customer documents." onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} style={{ minHeight: 140 }} />
          <p className="muted">Up to {MAX_SOURCE_CHARACTERS.toLocaleString()} characters per source; {Math.max(0, remainingCharacters).toLocaleString()} total characters remain.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" type="button" onClick={addOrReplaceSource} disabled={busy}>{editingId ? "Replace mock source" : "Add mock source"}</button>
            {editingId && <button className="btn ghost" type="button" onClick={() => { setEditingId(null); setDraft(emptyDraft); }} disabled={busy}>Cancel replace</button>}
            <label className="btn ghost" htmlFor="knowledge-source-file" aria-disabled={busy}><FileText size={16} /> Choose local .txt/.md<input id="knowledge-source-file" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={addFile} disabled={busy} hidden /></label>
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}><h4>Mock sources ({sources.length}/{MAX_KNOWLEDGE_SOURCES})</h4>{sources.length > 0 && <button className="btn ghost" type="button" onClick={clearEphemeralKnowledge} disabled={busy}>Clear all</button>}</div>
          {!sources.length && <p className="muted">No mock sources yet. Source text remains only in this browser until reset, authorization loss, or removal.</p>}
          {sources.map((source) => <article key={source.id} className="notice" style={{ display: "block", marginTop: 8 }}><strong>{source.title}</strong><p className="muted">{source.content.length.toLocaleString()} characters · local only</p><div style={{ display: "flex", gap: 8 }}><button className="btn ghost" type="button" onClick={() => editSource(source)} disabled={busy}>Replace</button><button className="btn ghost" type="button" onClick={() => removeSource(source.id)} disabled={busy}><Trash2 size={15} /> Remove</button></div></article>)}
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <label className="muted" htmlFor="knowledge-question">Mock question for lexical excerpt matching</label>
        <textarea id="knowledge-question" className="input" value={question} maxLength={MAX_KNOWLEDGE_QUESTION_CHARACTERS + 1} placeholder="Ask about the fictional notes you added." onChange={(event) => setQuestion(event.target.value)} style={{ minHeight: 80 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}><button className="btn primary" type="button" onClick={findExcerpts} disabled={busy || !sources.length || !question.trim()}><Search size={16} /> Find source excerpts</button><span className="muted">At most three verbatim excerpts; no generated answer.</span></div>
      </div>
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
      {notice && <p role="status" className="muted">{notice}</p>}
      <div style={{ marginTop: 18 }} aria-live="polite">
        <h4>Retrieval preview</h4>
        {!matches.length && question.trim() && !error && <p className="muted">{NO_MATCHING_EXCERPT}</p>}
        {!matches.length && !question.trim() && <p className="muted">Add fictional sources and a question to inspect cited, verbatim excerpts.</p>}
        {matches.map((match) => <article key={`${match.sourceId}-${match.excerptIndex}`} className="notice" style={{ display: "block", marginTop: 8 }}><p><strong>Citation:</strong> {match.sourceTitle} · excerpt {match.excerptIndex} · matched {match.matchedTerms.join(", ")}</p><blockquote style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{match.excerpt}</blockquote><button className="btn ghost" type="button" onClick={() => { onCopyExcerpt(match.excerpt); setNotice("Excerpt copied into the local sample-message field only. Run simulation separately to create a mock event."); }} disabled={busy}>Copy excerpt to sample message</button></article>)}
      </div>
    </>}
  </section>;
}
