import { createHmac, timingSafeEqual } from "node:crypto";

export type ReplayStore = { claim(key: string, expiresAt: number, now?: number): boolean };
export class MemoryReplayStore implements ReplayStore { private readonly entries = new Map<string, number>(); claim(key: string, expiresAt: number, now = Date.now()) { for (const [item, expiry] of this.entries) if (expiry <= now) this.entries.delete(item); if (this.entries.has(key)) return false; this.entries.set(key, expiresAt); return true; } }
export type WebhookInput = { organizationId: string; provider: string; eventId: string; timestamp: number; body: string; signature: string };
export function signWebhook(secret: string, input: Omit<WebhookInput, "signature">) { return createHmac("sha256", secret).update(`${input.organizationId}.${input.provider}.${input.eventId}.${input.timestamp}.${input.body}`).digest("hex"); }
export function verifyWebhook(input: WebhookInput, secret: string, replay: ReplayStore, now = Date.now(), toleranceMs = 300_000) {
  if (!secret || !input.organizationId || !input.eventId || !input.body || !Number.isSafeInteger(input.timestamp) || Math.abs(now - input.timestamp) > toleranceMs) return { ok: false as const, error: "Invalid or expired webhook." };
  const expected = signWebhook(secret, input); const actual = Buffer.from(input.signature, "hex"); const wanted = Buffer.from(expected, "hex"); if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false as const, error: "Invalid webhook signature." };
  if (!replay.claim(`${input.organizationId}:${input.provider}:${input.eventId}`, input.timestamp + toleranceMs, now)) return { ok: false as const, error: "Duplicate webhook event." };
  return { ok: true as const, organizationId: input.organizationId, eventId: input.eventId };
}
