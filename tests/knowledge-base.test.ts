import { describe, expect, it } from "vitest";
import { knowledgeSourceSchema } from "@/lib/schemas";
import { knowledgeSourceAvailability, knowledgeSourcePreview, summarizeKnowledgeAvailability } from "@/lib/knowledge-source";

describe("knowledge source contract", () => {
  it("accepts bounded text sources", () => {
    expect(knowledgeSourceSchema.safeParse({ title: "Support policy", source_type: "text", source_uri: "Synthetic local reference" }).success).toBe(true);
  });
  it("requires content for text sources and bounds it", () => {
    expect(knowledgeSourceSchema.safeParse({ title: "Missing", source_type: "text" }).success).toBe(false);
    expect(knowledgeSourceSchema.safeParse({ title: "Too large", source_type: "text", source_uri: "x".repeat(50001) }).success).toBe(false);
  });
  it("supports reference types without pretending to ingest them", () => {
    expect(knowledgeSourceSchema.safeParse({ title: "Docs", source_type: "url", source_uri: "https://example.test/docs" }).success).toBe(true);
    expect(knowledgeSourceSchema.safeParse({ title: "Bad docs", source_type: "url", source_uri: "javascript:alert(1)" }).success).toBe(false);
    expect(knowledgeSourceSchema.safeParse({ title: "File", source_type: "file", source_uri: "synthetic-upload.txt" }).success).toBe(true);
    expect(knowledgeSourceSchema.safeParse({ title: "Missing file", source_type: "file" }).success).toBe(false);
  });
  it("describes every source as stored-only until indexing and retrieval are approved", () => {
    const source = { title: "Policy", source_type: "text" as const, source_uri: "  A   short policy.  " };
    expect(knowledgeSourceAvailability(source)).toMatchObject({ indexed: false, retrievable: false, label: "Stored reference only" });
    expect(knowledgeSourcePreview(source)).toBe("A short policy.");
    expect(summarizeKnowledgeAvailability([source])).toEqual({ total: 1, storedReferences: 1, indexed: 0, retrievable: 0 });
  });
});
