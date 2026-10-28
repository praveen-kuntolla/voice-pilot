export type GatewayEventType =
  | "authorization_denied"
  | "consent_rejected"
  | "emergency_stop_rejected"
  | "rate_exhausted"
  | "concurrency_exhausted"
  | "duplicate_idempotency"
  | "budget_rejected"
  | "transaction_failed"
  | "transaction_rolled_back"
  | "pool_failed"
  | "cleanup_lag";

export type GatewaySecurityEvent = {
  type: GatewayEventType;
  correlationId: string;
  organizationId?: string;
  reason: string;
  occurredAt: number;
};

export interface GatewayEventSink { emit(event: GatewaySecurityEvent): void | Promise<void> }

const safeText = (value: string, maximum: number) => typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\r\n]/.test(value);

export function createGatewayEvent(input: GatewaySecurityEvent): GatewaySecurityEvent | null {
  if (!safeText(input.type, 64) || !safeText(input.correlationId, 128) || !safeText(input.reason, 160) || !Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0 || (input.organizationId !== undefined && !safeText(input.organizationId, 128))) return null;
  return { type: input.type, correlationId: input.correlationId, reason: input.reason, occurredAt: input.occurredAt, ...(input.organizationId ? { organizationId: input.organizationId } : {}) };
}

export class MemoryGatewayEventSink implements GatewayEventSink {
  readonly events: GatewaySecurityEvent[] = [];
  emit(event: GatewaySecurityEvent) { const safe = createGatewayEvent(event); if (safe) this.events.push(safe); }
}
