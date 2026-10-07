// Restore drill: restore every replicated database into a scratch directory and prove it is complete and consistent.
// Never touches the live data directory: everything lands in a fresh directory under the OS temp dir.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHint, findLitestream, restoreReplica } from './litestream.mjs';
import { isInside, listFileReplicaDbs, verifyDb } from './verify.mjs';
import { replicaUrl } from './config.mjs';

const expectedFor = (file, expected) => (file === 'control.db' ? expected.control : expected.project);

/**
 * @param {{ replica: string, manifest?: object, allowLag?: boolean, expected: {control:number[],project:number[]},
 *   pathEnv?: string, scratchParent?: string, keep?: boolean }} opts
 * Returns { ok, fatal?, scratch, results[] }.
 */
export function runDrill({
  replica,
  manifest,
  allowLag = false,
  expected,
  pathEnv,
  scratchParent = tmpdir(),
  keep = false,
}) {
  const binary = findLitestream(pathEnv);
  if (!binary) return { ok: false, fatal: installHint(), scratch: null, results: [] };
  if (manifest && isInside(scratchParent, manifest.dataDir)) {
    return {
      ok: false,
      fatal: `refusing to restore inside the live data directory ${manifest.dataDir}`,
      scratch: null,
      results: [],
    };
  }
  let files = manifest ? Object.keys(manifest.databases) : [];
  if (!manifest) {
    if (!replica.startsWith('file://')) {
      return {
        ok: false,
        fatal: 'this replica type cannot be listed: pass --manifest <file> (npm run backup:manifest)',
        scratch: null,
        results: [],
      };
    }
    files = listFileReplicaDbs(replica.slice('file://'.length));
    if (files.length === 0)
      return { ok: false, fatal: `no replicated databases found at ${replica}`, scratch: null, results: [] };
  }
  mkdirSync(scratchParent, { recursive: true });
  const scratch = mkdtempSync(join(scratchParent, 'ub-restore-'));
  const results = [];
  for (const file of files) {
    const out = join(scratch, file);
    const r = restoreReplica(binary, replicaUrl(replica, file), out);
    if (!r.ok || !existsSync(out)) {
      results.push({
        file,
        ok: false,
        problems: [`restore failed: ${r.message || 'no file produced'}`],
        stats: null,
      });
      continue;
    }
    results.push(
      verifyDb({
        file,
        path: out,
        migrations: expectedFor(file, expected),
        migrationState: expected.migrationState,
        manifestEntry: manifest?.databases[file],
        allowLag,
      }),
    );
  }
  if (manifest) {
    for (const file of Object.keys(manifest.databases)) {
      if (!results.some((x) => x.file === file))
        results.push({ file, ok: false, problems: ['not restored'], stats: null });
    }
  }
  if (!keep) rmSync(scratch, { recursive: true, force: true });
  return { ok: results.every((r) => r.ok), scratch: keep ? scratch : null, results };
}

export function formatReport(report) {
  if (report.fatal) return `DRILL FAILED\n${report.fatal}\n`;
  const lines = [report.ok ? 'DRILL PASSED' : 'DRILL FAILED'];
  for (const r of report.results) {
    const seq = r.stats?.maxSeq ?? '-';
    const rows = r.stats ? Object.values(r.stats.tables).reduce((a, b) => a + b, 0) : 0;
    lines.push(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.file}  max(seq)=${seq}  rows=${rows}`);
    for (const p of r.problems) lines.push(`         - ${p}`);
  }
  if (report.scratch) lines.push(`restored files kept in ${report.scratch}`);
  return lines.join('\n') + '\n';
}

async function loadExpected() {
  const { expectedMigrations } = await import('./expected.mjs');
  return expectedMigrations();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const mi = args.indexOf('--manifest');
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--manifest');
  if (positional.length !== 1) {
    console.error(
      'usage: npm run backup:drill -- <replica-url> [--manifest manifest.json] [--allow-lag] [--keep]',
    );
    process.exit(2);
  }
  const manifest = mi >= 0 ? JSON.parse(readFileSync(args[mi + 1], 'utf8')) : undefined;
  const report = runDrill({
    replica: positional[0],
    manifest,
    allowLag: flag('--allow-lag'),
    keep: flag('--keep'),
    expected: await loadExpected(),
  });
  process.stdout.write(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}
