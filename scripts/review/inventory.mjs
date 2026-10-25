// Read and fingerprint every tracked file; syntax-check JS without executing probes.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const paths = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n');
const rows = paths.map(path => {
  const bytes = readFileSync(path), text = bytes.toString('utf8');
  const syntax = path.endsWith('.mjs') ? spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true }) : null;
  return { path, bytes: bytes.length, lines: text.split('\n').length, sha256: createHash('sha256').update(bytes).digest('hex'), category: path.startsWith('packages/') ? (path.includes('.test.') ? 'tests' : 'runtime/build') : path.startsWith('scripts/') ? 'experiments/harness' : path.startsWith('docs/') ? 'documentation' : 'repository/build', purpose: text.split('\n').filter(s => s.trim()).slice(0, 4).join(' ').slice(0, 450), headings: path.endsWith('.md') ? text.split('\n').filter(s => /^#{1,3} /.test(s)) : undefined, syntax: syntax ? { ok: syntax.status === 0, error: syntax.stderr.trim() || undefined } : undefined };
});
writeFileSync('docs/review-file-inventory-2026-10-24.json', JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files: rows }, null, 2) + '\n');
console.log(JSON.stringify({ files: rows.length, totalLines: rows.reduce((n, r) => n + r.lines, 0), syntaxChecked: rows.filter(r => r.syntax).length, syntaxFailures: rows.filter(r => r.syntax && !r.syntax.ok) }, null, 2));
for (const row of rows.filter(r => r.path.startsWith('scripts/'))) console.log(row.path + ' ' + row.purpose.slice(0, 170));
