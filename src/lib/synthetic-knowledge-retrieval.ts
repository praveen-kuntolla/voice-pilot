export type SyntheticKnowledgeDocument = { id: `synthetic-${string}`; title: string; text: string };
export type SyntheticKnowledgeChunk = { documentId: SyntheticKnowledgeDocument["id"]; title: string; chunkIndex: number; text: string };
export type SyntheticRetrievalResult = SyntheticKnowledgeChunk & { score: number };

export const SYNTHETIC_KNOWLEDGE_DOCUMENTS: readonly SyntheticKnowledgeDocument[] = [
  { id: "synthetic-support-hours", title: "Support hours", text: "Support is available Monday through Friday from 09:00 to 17:00 UTC. Urgent safety issues should use the approved escalation path." },
  { id: "synthetic-account-help", title: "Account help", text: "Account owners can update profile details from Settings. Password recovery uses the verified recovery email and does not expose account secrets." },
  { id: "synthetic-product-overview", title: "Product overview", text: "VoicePilot provides configuration review and offline simulation. Live calls, provider activation, and customer data processing are disabled in this demonstration." },
];
export const SYNTHETIC_RETRIEVAL_LIMIT = 3;
function terms(value: string) { return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])]; }
export function segmentSyntheticKnowledge(documents = SYNTHETIC_KNOWLEDGE_DOCUMENTS): SyntheticKnowledgeChunk[] { return documents.flatMap((document) => document.text.split(/(?<=[.!?])\s+/).filter(Boolean).map((text, chunkIndex) => ({ documentId: document.id, title: document.title, chunkIndex, text }))); }
export function retrieveSyntheticKnowledge(query: string, limit = SYNTHETIC_RETRIEVAL_LIMIT, documents = SYNTHETIC_KNOWLEDGE_DOCUMENTS): SyntheticRetrievalResult[] {
  const queryTerms = terms(query);
  if (!queryTerms.length || !Number.isInteger(limit) || limit < 1) return [];
  return segmentSyntheticKnowledge(documents).map((chunk) => ({ ...chunk, score: queryTerms.filter((term) => terms(chunk.text).includes(term)).length })).filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.chunkIndex - b.chunkIndex).slice(0, Math.min(limit, SYNTHETIC_RETRIEVAL_LIMIT));
}
export function simulateSyntheticKnowledgeResponse(query: string, limit = SYNTHETIC_RETRIEVAL_LIMIT) { const results = retrieveSyntheticKnowledge(query, limit); return { simulationOnly: true as const, providerCalled: false as const, query: query.trim(), results, answer: results.length ? results.map((result) => `${result.title}: ${result.text}`).join(" ") : "No synthetic knowledge matched this query." }; }
