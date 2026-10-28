import { describe, expect, it, vi } from "vitest";
import { PostgresTransactionExecutor } from "@/lib/postgres-transaction-executor";
import { MemoryGatewayEventSink } from "@/lib/gateway-observability";
import { GatewayTransactionAbort } from "@/lib/gateway-transaction-abort";

function fakePool(failConnect = false, failRollback = false, failCommit = false) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const release = vi.fn();
  const client = { query: vi.fn(async (text: string, values?: unknown[]) => { calls.push({ text, values }); if ((failRollback && text === "rollback") || (failCommit && text === "commit")) throw new Error("unsafe database detail"); return { rows: [{ value: true }] }; }), release };
  return { calls, release, pool: { connect: failConnect ? async () => { throw new Error("secret connection detail"); } : async () => client } };
}

describe("Postgres transaction executor", () => {
  it("begins, applies a local timeout, commits and always releases", async () => {
    const fixture = fakePool();
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000, databaseRole: "service_role" });
    await expect(executor.transaction(async (query) => (await query<{ value: boolean }>("select $1::boolean value", [true])).rows[0].value)).resolves.toBe(true);
    expect(fixture.calls.map((call) => call.text)).toEqual(["begin", "set local role service_role", "select set_config('statement_timeout',$1::text,true)", "select $1::boolean value", "commit"]);
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(fixture.release).toHaveBeenCalledWith(undefined);
  });

  it("rolls back and releases on failure without exposing database errors", async () => {
    const fixture = fakePool(); const events = new MemoryGatewayEventSink();
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000, observer: events, correlationId: () => "corr-1", now: () => 10 });
    await expect(executor.transaction(async () => { throw new Error("contains credential"); })).rejects.toThrow("gateway_unavailable");
    expect(fixture.calls.map((call) => call.text)).toContain("rollback");
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(fixture.release).toHaveBeenCalledWith(undefined);
    expect(events.events).toEqual([expect.objectContaining({ type: "transaction_rolled_back", correlationId: "corr-1" })]);
  });

  it("discards a connection when rollback fails and never exposes the cleanup error", async () => {
    const fixture = fakePool(false, true); const events = new MemoryGatewayEventSink();
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000, observer: events, now: () => 10 });
    await expect(executor.transaction(async () => { throw new Error("private operation detail"); })).rejects.toThrow("gateway_unavailable");
    expect(fixture.release).toHaveBeenCalledWith(expect.objectContaining({ message: "discard_unsafe_connection" }));
    expect(events.events).toContainEqual(expect.objectContaining({ type: "transaction_failed" }));
    expect(JSON.stringify(events.events)).not.toMatch(/private|database detail/);
  });

  it("does not reuse a discarded client for a later tenant", async () => {
    const first = fakePool(false, true); const second = fakePool(); let connections = 0;
    const pool = { connect: async () => (++connections === 1 ? first.pool.connect() : second.pool.connect()) };
    const executor = new PostgresTransactionExecutor(pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000 });
    await expect(executor.transaction(async () => { throw new Error("fail"); })).rejects.toThrow("gateway_unavailable");
    await expect(executor.transaction(async (query) => { await query("select set_config('voicepilot.organization_id',$1,true)", ["tenant-b"]); return true; })).resolves.toBe(true);
    expect(first.release).toHaveBeenCalledWith(expect.any(Error));
    expect(second.calls.some((call) => call.values?.includes("tenant-b"))).toBe(true);
    expect(first.calls.some((call) => call.values?.includes("tenant-b"))).toBe(false);
  });

  it("discards a connection after an uncertain commit even when rollback responds", async () => {
    const fixture = fakePool(false, false, true);
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000 });
    await expect(executor.transaction(async () => true)).rejects.toThrow("gateway_unavailable");
    expect(fixture.calls.map((call) => call.text)).toContain("rollback");
    expect(fixture.release).toHaveBeenCalledWith(expect.objectContaining({ message: "discard_uncertain_connection" }));
  });

  it("fails closed when the pool is exhausted or unavailable", async () => {
    const fixture = fakePool(true); const events = new MemoryGatewayEventSink();
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000, observer: events, now: () => 10 });
    await expect(executor.transaction(async () => true)).rejects.toThrow("gateway_unavailable");
    expect(events.events[0]).toMatchObject({ type: "pool_failed" });
  });

  it("rolls back a domain denial, releases normally, and preserves the denial", async () => {
    const fixture = fakePool(); const denial = { status: "denied", reason: "resource_not_found" } as const;
    const executor = new PostgresTransactionExecutor(fixture.pool as unknown as ConstructorParameters<typeof PostgresTransactionExecutor>[0], { statementTimeoutMs: 5_000 });
    await expect(executor.transaction(async () => { throw new GatewayTransactionAbort(denial); })).rejects.toMatchObject({ result: denial });
    expect(fixture.calls.map((call) => call.text)).toContain("rollback");
    expect(fixture.release).toHaveBeenCalledWith(undefined);
  });
});
