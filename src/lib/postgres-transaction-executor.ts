import { Pool, type PoolConfig, type PoolClient, type QueryResultRow } from "pg";
import type { SafetyQuery } from "@/lib/postgres-durable-safety";
import type { SafetyTransactionExecutor } from "@/lib/privileged-safety-gateway";
import { createGatewayEvent, type GatewayEventSink } from "@/lib/gateway-observability";
import { GatewayTransactionAbort } from "@/lib/gateway-transaction-abort";

if (typeof window !== "undefined") throw new Error("PostgreSQL transaction execution is server-only");

type PoolLike = { connect(): Promise<Pick<PoolClient, "query" | "release">>; end?(): Promise<void> };

export class PostgresTransactionExecutor implements SafetyTransactionExecutor {
  constructor(private readonly pool: PoolLike, private readonly options: { statementTimeoutMs: number; databaseRole?: "service_role"; observer?: GatewayEventSink; correlationId?: () => string; now?: () => number }) {}

  async transaction<T>(work: (query: SafetyQuery) => Promise<T>): Promise<T> {
    const now = this.options.now ?? Date.now;
    const correlationId = this.options.correlationId?.() ?? "offline-gateway";
    if (!Number.isSafeInteger(this.options.statementTimeoutMs) || this.options.statementTimeoutMs < 1 || this.options.statementTimeoutMs > 120_000) throw new Error("gateway_unavailable");
    let client: Pick<PoolClient, "query" | "release"> | undefined;
    let began = false;
    try {
      client = await this.pool.connect();
      await client.query("begin"); began = true;
      if (this.options.databaseRole) await client.query("set local role service_role");
      await client.query("select set_config('statement_timeout',$1::text,true)", [String(this.options.statementTimeoutMs)]);
      const query: SafetyQuery = async <R extends Record<string, unknown>>(sql: string, values: readonly unknown[]) => {
        const result = await client!.query<R & QueryResultRow>(sql, [...values]);
        return { rows: result.rows };
      };
      const value = await work(query);
      await client.query("commit"); began = false;
      return value;
    } catch (error) {
      if (client && began) {
        try { await client.query("rollback"); began = false; this.emit("transaction_rolled_back", correlationId, now()); }
        catch { this.emit("transaction_failed", correlationId, now()); }
      } else this.emit("pool_failed", correlationId, now());
      if (error instanceof GatewayTransactionAbort) throw error;
      throw new Error("gateway_unavailable");
    } finally {
      client?.release();
    }
  }

  private emit(type: "transaction_rolled_back" | "transaction_failed" | "pool_failed", correlationId: string, occurredAt: number) {
    const event = createGatewayEvent({ type, correlationId, reason: "offline_gateway_failure", occurredAt });
    if (event) void this.options.observer?.emit(event);
  }
}

export function createDisposableLocalGatewayPool(config: PoolConfig & { connectionString: string }) {
  const url = new URL(config.connectionString);
  if (!(["127.0.0.1", "localhost"].includes(url.hostname)) || !/^vp_gateway_[a-z0-9_]+$/i.test(url.pathname.slice(1))) throw new Error("Refusing non-disposable PostgreSQL target");
  return new Pool({ ...config, max: Math.min(config.max ?? 4, 8), connectionTimeoutMillis: Math.min(config.connectionTimeoutMillis ?? 5_000, 10_000), idleTimeoutMillis: Math.min(config.idleTimeoutMillis ?? 5_000, 30_000) });
}
