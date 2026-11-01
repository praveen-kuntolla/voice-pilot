import assert from 'node:assert/strict';
import { preparePhase12FConcurrencyPlan, PHASE12F_SCENARIOS } from './lib/phase12f-disposable-concurrency-adapter.mjs';

const plan = preparePhase12FConcurrencyPlan();
assert.deepEqual(plan.map((entry) => entry.name), PHASE12F_SCENARIOS);
assert(plan.every((entry) => entry.requiresReviewSql && entry.requiresCleanup));
assert(plan.some((entry) => entry.status === 'blocked_pending_evidence_approval'));
console.log('PHASE12F_CONCURRENCY_ADAPTER_OFFLINE_OK');
