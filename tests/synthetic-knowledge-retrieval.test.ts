import { describe, expect, it } from "vitest";
import { retrieveSyntheticKnowledge, segmentSyntheticKnowledge, simulateSyntheticKnowledgeResponse, SYNTHETIC_KNOWLEDGE_DOCUMENTS } from "@/lib/synthetic-knowledge-retrieval";

describe("offline synthetic knowledge retrieval", () => {
  it("segments fixed documents deterministically and attributes sources", () => {
    const first = segmentSyntheticKnowledge();
    expect(segmentSyntheticKnowledge()).toEqual(first);
    expect(first.every((chunk) => chunk.documentId.startsWith("synthetic-"))).toBe(true);
  });
  it("matches keywords with bounded deterministic ordering", () => {
    const results = retrieveSyntheticKnowledge("support UTC", 10);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results[0]).toMatchObject({ documentId: "synthetic-support-hours", title: "Support hours" });
    expect(retrieveSyntheticKnowledge("support UTC", 10)).toEqual(results);
  });
  it("handles empty results and never accepts non-synthetic content as a default", () => {
    expect(retrieveSyntheticKnowledge("quantum submarine")).toEqual([]);
    expect(simulateSyntheticKnowledgeResponse("quantum submarine")).toMatchObject({ simulationOnly: true, providerCalled: false, results: [] });
    expect(SYNTHETIC_KNOWLEDGE_DOCUMENTS.every((document) => document.id.startsWith("synthetic-"))).toBe(true);
  });
  it("does not expose a tenant or database input boundary", () => {
    expect(retrieveSyntheticKnowledge("account", 1)[0]?.documentId).toBe("synthetic-account-help");
  });
});
