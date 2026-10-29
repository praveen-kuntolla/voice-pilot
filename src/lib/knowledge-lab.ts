/**
 * Browser-only, extractive retrieval helpers for the simulation Knowledge Lab.
 * This module deliberately has no fetches, storage access, provider adapters, or
 * answer-generation behavior. Callers retain source text only in ephemeral UI state.
 */

export const MAX_KNOWLEDGE_SOURCES = 5;
export const MAX_SOURCE_CHARACTERS = 10_000;
export const MAX_TOTAL_SOURCE_CHARACTERS = 40_000;
/** Conservative browser-file limit before decoding text into JavaScript memory. */
export const MAX_KNOWLEDGE_FILE_BYTES = 40_000;
export const MAX_KNOWLEDGE_QUESTION_CHARACTERS = 500;
export const MAX_RETRIEVAL_MATCHES = 3;
export const MAX_PASSAGE_CHARACTERS = 700;

export type KnowledgeSource = {
  id: string;
  title: string;
  content: string;
};

export type KnowledgeSourceCandidate = Pick<KnowledgeSource, "title" | "content">;

export type KnowledgeValidation =
  | { ok: true; value: KnowledgeSourceCandidate }
  | { ok: false; error: string };

export type KnowledgeExcerpt = {
  sourceId: string;
  sourceTitle: string;
  excerptIndex: number;
  excerpt: string;
  matchedTerms: string[];
  score: number;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or", "our", "the", "to", "what", "when", "where", "with", "you", "your",
]);

export const NO_MATCHING_EXCERPT = "No matching source excerpt — no grounded answer available.";

function hasUnsafeControlCharacters(value: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

/** Validation shared by pasted and browser-file source input. */
export function validateKnowledgeSource(
  candidate: KnowledgeSourceCandidate,
  options: { existingCount: number; existingCharacterCount: number } = { existingCount: 0, existingCharacterCount: 0 },
): KnowledgeValidation {
  const title = candidate.title.trim();
  const content = candidate.content;
  if (!title) return { ok: false, error: "A mock source title is required." };
  if (title.length > 120) return { ok: false, error: "Mock source titles must be 120 characters or fewer." };
  if (hasUnsafeControlCharacters(title) || hasUnsafeControlCharacters(content)) return { ok: false, error: "Source input contains unsupported control characters." };
  if (!content.trim()) return { ok: false, error: "Mock source content cannot be empty." };
  if (content.length > MAX_SOURCE_CHARACTERS) return { ok: false, error: `Each mock source must be ${MAX_SOURCE_CHARACTERS.toLocaleString()} characters or fewer.` };
  if (options.existingCount >= MAX_KNOWLEDGE_SOURCES) return { ok: false, error: `Add at most ${MAX_KNOWLEDGE_SOURCES} mock sources.` };
  if (!Number.isSafeInteger(options.existingCharacterCount) || options.existingCharacterCount < 0) return { ok: false, error: "Source size could not be validated." };
  if (options.existingCharacterCount + content.length > MAX_TOTAL_SOURCE_CHARACTERS) return { ok: false, error: `Mock sources must total ${MAX_TOTAL_SOURCE_CHARACTERS.toLocaleString()} characters or fewer.` };
  return { ok: true, value: { title, content } };
}

export function validateKnowledgeQuestion(question: string) {
  if (!question.trim()) return "Enter a mock question to find source excerpts.";
  if (question.length > MAX_KNOWLEDGE_QUESTION_CHARACTERS) return `Mock questions must be ${MAX_KNOWLEDGE_QUESTION_CHARACTERS} characters or fewer.`;
  if (hasUnsafeControlCharacters(question)) return "The mock question contains unsupported control characters.";
  return null;
}

export function isSupportedKnowledgeFile(file: Pick<File, "name" | "type">) {
  const name = file.name.toLowerCase();
  const expectedExtension = name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
  const supportedType = file.type === "" || file.type === "text/plain" || file.type === "text/markdown";
  return expectedExtension && supportedType;
}

/** Reject unsupported or too-large browser files before File.text() allocates content. */
export function validateKnowledgeFile(file: Pick<File, "name" | "type" | "size">) {
  if (!isSupportedKnowledgeFile(file)) return "Only local .txt, .md, or .markdown mock files are supported. Files are never uploaded.";
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_KNOWLEDGE_FILE_BYTES) return `Mock files must be ${MAX_KNOWLEDGE_FILE_BYTES.toLocaleString()} bytes or smaller.`;
  return null;
}

/**
 * Invalidates asynchronous browser File.text() completions when the authorized
 * session changes. It intentionally stores no source content.
 */
export class KnowledgeFileReadGate {
  private generation = 0;

  begin() { return ++this.generation; }
  invalidate() { this.generation++; }
  isCurrent(token: number) { return token === this.generation; }
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function meaningfulTerms(value: string) {
  const tokens = normalized(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  return [...new Set(tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

type Passage = { excerptIndex: number; excerpt: string };

/** Split exact source text into deterministic, bounded excerpts without rewriting it. */
export function splitKnowledgePassages(content: string): Passage[] {
  const passages: Passage[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(content.length, start + MAX_PASSAGE_CHARACTERS);
    if (end < content.length) {
      const boundary = Math.max(
        content.lastIndexOf("\n", end),
        content.lastIndexOf(". ", end) + 1,
        content.lastIndexOf("! ", end) + 1,
        content.lastIndexOf("? ", end) + 1,
      );
      if (boundary > start + Math.floor(MAX_PASSAGE_CHARACTERS / 3)) end = boundary;
    }
    const excerpt = content.slice(start, end).trim();
    if (excerpt) passages.push({ excerptIndex: passages.length + 1, excerpt });
    start = end;
  }
  return passages;
}

/**
 * Stable lexical retrieval. Returned excerpts always come verbatim from a selected
 * source. It does not infer, synthesize, or execute document instructions.
 */
export function retrieveKnowledgeExcerpts(sources: readonly KnowledgeSource[], question: string): KnowledgeExcerpt[] {
  const queryTerms = meaningfulTerms(question);
  if (!queryTerms.length) return [];
  const matches: Array<KnowledgeExcerpt & { sourceOrder: number }> = [];
  sources.forEach((source, sourceOrder) => {
    const duplicatePassages = new Set<string>();
    splitKnowledgePassages(source.content).forEach(({ excerptIndex, excerpt }) => {
      const normalizedExcerpt = normalized(excerpt);
      if (duplicatePassages.has(normalizedExcerpt)) return;
      duplicatePassages.add(normalizedExcerpt);
      const matchedTerms = queryTerms.filter((term) => meaningfulTerms(normalizedExcerpt).includes(term));
      if (!matchedTerms.length) return;
      matches.push({ sourceId: source.id, sourceTitle: source.title, excerptIndex, excerpt, matchedTerms, score: matchedTerms.length, sourceOrder });
    });
  });
  return matches
    .sort((left, right) => right.score - left.score || left.sourceOrder - right.sourceOrder || left.excerptIndex - right.excerptIndex)
    .slice(0, MAX_RETRIEVAL_MATCHES)
    .map(({ sourceOrder: _sourceOrder, ...match }) => match);
}
