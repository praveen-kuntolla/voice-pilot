import { createHmac, timingSafeEqual } from "node:crypto";

export type ReplayStore = { claim(key: string, expiresAt: number, now?: number): boolean };
export class MemoryReplayStore implements ReplayStore { private readonly entries = new Map<string, number>(); claim(key: string, expiresAt: number, now = Date.now()) { if (!key || !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now) || expiresAt <= now) return false; for (const [item, expiry] of this.entries) if (expiry <= now) this.entries.delete(item); if (this.entries.has(key)) return false; this.entries.set(key, expiresAt); return true; } }
export type WebhookInput = { organizationId: string; provider: string; eventId: string; timestamp: number; body: string; signature: string };
function field(value: string) { const bytes = Buffer.from(value, "utf8"); return Buffer.concat([Buffer.from(`${bytes.length}:`, "ascii"), bytes]); }
export function canonicalWebhookPayload(input: Omit<WebhookInput, "signature">) { return Buffer.concat([field(input.organizationId), field(input.provider), field(input.eventId), field(String(input.timestamp)), field(input.body)]); }
export function signWebhook(secret: string, input: Omit<WebhookInput, "signature">) { return createHmac("sha256", secret).update(canonicalWebhookPayload(input)).digest("hex"); }
export function verifyWebhook(input: WebhookInput, secret: string, replay: ReplayStore, now = Date.now(), toleranceMs = 300_000) {
  if (!secret || !input.organizationId.trim() || !input.provider.trim() || !input.eventId.trim() || typeof input.body !== "string" || !Number.isSafeInteger(input.timestamp) || !Number.isSafeInteger(now) || !Number.isSafeInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > 86_400_000 || Math.abs(now - input.timestamp) > toleranceMs || !/^[a-f0-9]{64}$/i.test(input.signature)) return { ok: false as const, error: "Invalid or expired webhook." };
  const expected = signWebhook(secret, input); const actual = Buffer.from(input.signature, "hex"); const wanted = Buffer.from(expected, "hex"); if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false as const, error: "Invalid webhook signature." };
  const replayKey = Buffer.concat([field(input.organizationId), field(input.provider), field(input.eventId)]).toString("base64url"); if (!replay.claim(replayKey, input.timestamp + toleranceMs, now)) return { ok: false as const, error: "Duplicate webhook event." };
  return { ok: true as const, organizationId: input.organizationId, eventId: input.eventId };
}
