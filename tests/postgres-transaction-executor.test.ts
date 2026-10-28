import { describe, expect, it, vi } from "vitest";
import { PostgresTransactionExecutor } from "@/lib/postgres-transaction-executor";
import { MemoryGatewayEventSink } from "@/lib/gateway-observability";

function fakePool(failConnect = false) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const release = vi.fn();
  const client = { query: vi.fn(async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows: [{ value: true }] }; }), release };
  return { calls, release, pool: { connect: failConnect ? async () => { throw new Error("secret connection detail"); } : async () => client } };
}

describe("Postgres transaction executor", () => {
  it("begins, applies a local timeout, commits and always releases", async () => {
    const fixture = fakePool();
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000, databaseRole: "service_role" });
    await expect(executor.transaction(async (query) => (await query<{ value: boolean }>("select $1::boolean value", [true])).rows[0].value)).resolves.toBe(true);
    expect(fixture.calls.map((call) => call.text)).toEqual(["begin", "set local role service_role", "select set_config('statement_timeout',$1::text,true)", "select $1::boolean value", "commit"]);
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases on failure without exposing database errors", async () => {
    const fixture = fakePool(); const events = new MemoryGatewayEventSink();
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000, observer: events, correlationId: () => "corr-1", now: () => 10 });
    await expect(executor.transaction(async () => { throw new Error("contains credential"); })).rejects.toThrow("gateway_unavailable");
    expect(fixture.calls.map((call) => call.text)).toContain("rollback");
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(events.events).toEqual([expect.objectContaining({ type: "transaction_rolled_back", correlationId: "corr-1" })]);
  });

  it("fails closed when the pool is exhausted or unavailable", async () => {
    const fixture = fakePool(true); const events = new MemoryGatewayEventSink();
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000, observer: events, now: () => 10 });
    await expect(executor.transaction(async () => true)).rejects.toThrow("gateway_unavailable");
    expect(events.events[0]).toMatchObject({ type: "pool_failed" });
  });
});
