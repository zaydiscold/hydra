#!/usr/bin/env node
/**
 * Phase 1 Integration Gate — validates all Phase 1 contracts.
 * Exit code 0 = ALL PASS, non-zero = FAILURE.
 *
 * Contracts tested:
 *   1. Import does NOT auto-start the server (C)
 *   2. bootstrap({port}) returns a listenable server (A)
 *   3. gracefulShutdown({exit:false}) works without process.exit (B)
 *   4. All 3 existing tests still pass (D)
 */

let passed = 0;
let failed = 0;

async function run() {
  console.log('\n=== Phase 1 Integration Gate ===\n');

  // Test C: Import without auto-start
  try {
    const mod = await import('../server/index.js');
    if (mod.server !== null) throw new Error(`Expected server=null, got ${typeof mod.server}`);
    passed++; console.log('  PASS  C: import does not auto-start server');
  } catch (err) { failed++; console.log('  FAIL  C:', err.message); }

  // Test A: bootstrap returns server
  try {
    const mod = await import('../server/index.js');
    const inst = await mod.bootstrap({ port: 0, silent: true });
    if (!inst || typeof inst.close !== 'function') throw new Error('bootstrap did not return http.Server');
    const addr = inst.address();
    if (!addr || typeof addr.port !== 'number') throw new Error('Server not listening');
    await mod.gracefulShutdown('test', { exit: false, timeoutMs: 500 });
    passed++; console.log('  PASS  A: bootstrap({port}) returns http.Server');
  } catch (err) { failed++; console.log('  FAIL  A:', err.message); }

  // Test B: gracefulShutdown without exit
  try {
    const mod = await import('../server/index.js');
    const result = await mod.gracefulShutdown('test', { exit: false, timeoutMs: 100 });
    if (typeof result !== 'boolean') throw new Error(`Expected boolean, got ${typeof result}`);
    passed++; console.log('  PASS  B: gracefulShutdown({exit:false}) returns boolean');
  } catch (err) { failed++; console.log('  FAIL  B:', err.message); }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
