export type KnowledgeSourceRecord = {
  title: string;
  source_type: "text" | "url" | "file";
  source_uri?: string | null;
  status?: string | null;
};

export type KnowledgeSourceAvailability = {
  label: "Stored reference only";
  indexed: false;
  retrievable: false;
  detail: "Not indexed or available for agent retrieval";
};

export function knowledgeSourceAvailability(_: KnowledgeSourceRecord): KnowledgeSourceAvailability {
  return {
    label: "Stored reference only",
    indexed: false,
    retrievable: false,
    detail: "Not indexed or available for agent retrieval",
  };
}

export function knowledgeSourcePreview(source: KnowledgeSourceRecord, limit = 220) {
  const value = source.source_uri?.trim() ?? "";
  if (!value) return "No source reference stored.";
  if (source.source_type !== "text") return value;
  const compact = value.replace(/\s+/g, " ");
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

export function summarizeKnowledgeAvailability(sources: KnowledgeSourceRecord[]) {
  return {
    total: sources.length,
    storedReferences: sources.length,
    indexed: 0,
    retrievable: 0,
  };
}
