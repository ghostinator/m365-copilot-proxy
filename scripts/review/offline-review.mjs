// Post-fix verification; the original baseline evidence JSON is kept unchanged.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionPool } from '../../packages/proxy-lib/dist/index.mjs';
import { budgetConfig } from '../../packages/core/dist/index.mjs';
const pool = new SessionPool();
const original = [{ role: 'user', content: 'hello' }];
const a = pool.resolve(original);
pool.acknowledge(a, original, { role: 'assistant', content: 'a' });
const b = pool.resolve([{ role: 'system', content: 'different client' }, ...original, { role: 'assistant', content: 'b' }, { role: 'user', content: 'continue' }]);
assert.notEqual(a, b);
assert.notEqual(pool.resolve([{ role: 'user', content: 'Aa' }]), pool.resolve([{ role: 'user', content: 'BB' }]));
const logs = [join(tmpdir(), 'one.log'), join(tmpdir(), 'two.log')];
assert.ok(logs.every(path => budgetConfig({ M365_BUDGET_LOGS: logs.join(delimiter) }).dirs.includes(path)));
execFileSync(process.execPath, [resolve('scripts/test-installed-runtime.mjs')], { stdio: 'inherit' });
writeFileSync('docs/fix-offline-evidence-2026-10-24.json', JSON.stringify({ testedAt: new Date().toISOString(), independentHistoriesIsolated: true, oldHashCollisionsIsolated: true, nativeBudgetPathsPreserved: true, builtStartupAndPolicies: 'passed; explicit offline auth fixture only' }, null, 2) + '\n');
