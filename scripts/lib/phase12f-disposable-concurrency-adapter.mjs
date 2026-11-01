// Test-only adapter. It reuses startDisposableVoiceGateway and never applies
// the review-only Phase 12F SQL. Execution is opt-in and not used by default.
import assert from 'node:assert/strict';
import { startDisposableVoiceGateway } from './disposable-voice-gateway.mjs';
import { validateDisposableTarget, createBarrier } from '../test-phase12f-concurrency-harness.mjs';

export const PHASE12F_SCENARIOS = Object.freeze([
  'duplicate-lease-creation',
  'lease-creation-vs-cancellation',
  'begin-vs-complete-release',
  'complete-vs-reconciliation',
  'evidence-ingestion-vs-release',
  'failed-release-rollback',
  'provider-termination-uncertainty',
]);

const requireApproval = (options) => {
  assert.equal(options?.allowDisposableExecution, true, 'explicit disposable execution approval is required');
  assert.equal(options?.randomizedDatabase, true, 'randomized database marker is required');
  assert.equal(options?.reviewSqlApproved, true, 'review-only SQL approval is required before connection');
};

export function preparePhase12FConcurrencyPlan() {
  return PHASE12F_SCENARIOS.map((name) => ({
    name,
    status: ['evidence-ingestion-vs-release', 'provider-termination-uncertainty'].includes(name) ? 'blocked_pending_evidence_approval' : 'ready_for_approved_disposable_run',
    requiresReviewSql: true,
    requiresCleanup: true,
  }));
}
export async function startPhase12FDisposableConcurrencyAdapter(options = {}) {
  requireApproval(options);
  if (options.execute !== true) throw new Error('Execution is disabled by default; pass execute=true only after approval');
  const gateway = await startDisposableVoiceGateway({ fixtureIdentity: options.fixtureIdentity });
  let pool;
  let cleaned = false;
  try {
    validateDisposableTarget(gateway.gatewayUrl, { explicitExecution: true, randomizedDatabase: true });
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: gateway.gatewayUrl, max: options.connectionCount ?? 2, statement_timeout: 10_000, lock_timeout: 3_000 });
    const connections = await Promise.all(Array.from({ length: options.connectionCount ?? 2 }, () => pool.connect()));
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      for (const client of connections) { try { await client.query('rollback'); } finally { client.release(); } }
      await pool.end();
      await gateway.cleanup();
    };
    return { database: gateway.database, gateway, connections, barrier: createBarrier, scenarios: preparePhase12FConcurrencyPlan(), cleanup };
  } catch (error) {
    if (pool) await pool.end().catch(() => {});
    await gateway.cleanup().catch(() => {});
    throw error;
  }
}
