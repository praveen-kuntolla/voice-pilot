"use client";
import { useState } from "react";
import { simulateSyntheticKnowledgeResponse, SYNTHETIC_KNOWLEDGE_DOCUMENTS, SYNTHETIC_RETRIEVAL_LIMIT } from "@/lib/synthetic-knowledge-retrieval";

export function SyntheticKnowledgeRetrievalPanel() {
  const [query, setQuery] = useState("support hours");
  const [response, setResponse] = useState(() => simulateSyntheticKnowledgeResponse("support hours"));
  return <section className="card" aria-label="Synthetic knowledge retrieval" style={{ marginTop: 18 }}><h2>Offline synthetic knowledge demo</h2><p className="muted">Synthetic knowledge only · deterministic keyword matching · no live agent retrieval · no customer data processing.</p><p className="muted">Catalog: {SYNTHETIC_KNOWLEDGE_DOCUMENTS.length} fixed documents · maximum {SYNTHETIC_RETRIEVAL_LIMIT} results · session-local results.</p><label className="label" htmlFor="synthetic-knowledge-query">Query<input id="synthetic-knowledge-query" className="input" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} /></label><button className="btn ghost" type="button" onClick={() => setResponse(simulateSyntheticKnowledgeResponse(query))}>Run local retrieval</button><div role="status" style={{ marginTop: 12 }}><strong>{response.results.length ? `${response.results.length} synthetic match${response.results.length === 1 ? "" : "es"}` : "No synthetic matches"}</strong><p className="muted">{response.answer}</p>{response.results.map((result) => <p className="muted" key={`${result.documentId}-${result.chunkIndex}`}>Source: <code>{result.documentId}</code> · {result.title} · keyword score {result.score}</p>)}</div></section>;
}
