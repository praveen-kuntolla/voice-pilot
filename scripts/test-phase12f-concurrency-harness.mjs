#!/usr/bin/env node
// Test-only Phase 12F concurrency harness.
// Offline by default. It never applies migrations or creates databases.

import assert from 'node:assert/strict';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function validateDisposableTarget(rawUrl, { explicitExecution = false, randomizedDatabase = false } = {}) {
  const url = new URL(rawUrl);
  assert.equal(url.protocol, 'postgresql:', 'only postgresql:// URLs are supported');
  assert(LOOPBACK.has(url.hostname), 'database host must be loopback');
  assert(explicitExecution, 'execution requires an explicit disposable-test opt-in');
  assert(randomizedDatabase, 'execution requires a randomized test database');
  assert(url.searchParams.get('sslmode') !== 'require', 'production-style SSL targets are refused');
  return true;
}

export function createBarrier(parties) {
  assert(Number.isInteger(parties) && parties >= 2, 'barrier requires at least two parties');
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await gate;
  };
}

function runOfflineChecks() {
  assert.throws(() => validateDisposableTarget('postgresql://example.invalid/db', { explicitExecution: true, randomizedDatabase: true }));
  assert.throws(() => validateDisposableTarget('postgresql://127.0.0.1/db', { randomizedDatabase: true }));
  assert.throws(() => validateDisposableTarget('postgresql://127.0.0.1/db', { explicitExecution: true }));
  assert.equal(validateDisposableTarget('postgresql://127.0.0.1/randomized_test', { explicitExecution: true, randomizedDatabase: true }), true);
  assert.throws(() => validateDisposableTarget('postgresql://127.0.0.1/randomized_test?sslmode=require', { explicitExecution: true, randomizedDatabase: true }));
  const wait = createBarrier(2);
  return Promise.all([wait(), wait()]);
}

if (process.argv.includes('--execute')) {
  const target = process.env.PHASE12F_TEST_DATABASE_URL;
  if (!target || process.env.PHASE12F_RANDOM_DATABASE !== '1' || process.env.PHASE12F_ALLOW_DISPOSABLE !== '1') {
    throw new Error('Refusing execution: require PHASE12F_TEST_DATABASE_URL, PHASE12F_RANDOM_DATABASE=1, PHASE12F_ALLOW_DISPOSABLE=1');
  }
  validateDisposableTarget(target, { explicitExecution: true, randomizedDatabase: true });
  throw new Error('Execution path is intentionally disabled until independent approval and a database adapter are provided');
}

await runOfflineChecks();
console.log('PHASE12F_CONCURRENCY_OFFLINE_OK');
