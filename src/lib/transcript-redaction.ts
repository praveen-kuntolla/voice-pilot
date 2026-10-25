const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d[\d\s().-]{7,10}\d)(?!\d)/g;
const BEARER = /\bBearer\s+[A-Z0-9._~+/=-]{12,}/gi;
const API_KEY = /\b(?:sk|pk|api|key)[-_][A-Z0-9_-]{12,}\b/gi;
const CARD = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

function cardReplacement(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return value;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (alternate && (digit *= 2) > 9) digit -= 9;
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0 ? "[REDACTED CARD]" : value;
}

/** Best-effort local redaction for simulation exports; this is not a privacy guarantee. */
export function redactTranscript(value: string) {
  return value
    .replace(BEARER, "[REDACTED TOKEN]")
    .replace(API_KEY, "[REDACTED KEY]")
    .replace(CARD, cardReplacement)
    .replace(EMAIL, "[REDACTED EMAIL]")
    .replace(PHONE, "[REDACTED PHONE]")
    ;
}

export function redactTranscriptLines(lines: string[]) {
  return lines.map(redactTranscript);
}
