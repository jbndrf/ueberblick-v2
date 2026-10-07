// Manifest of a live data directory and verification of restored databases against it.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import { discoverDatabases } from './config.mjs';

const q = (name) => `"${name.replaceAll('"', '""')}"`;

function tableNames(raw) {
  return raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

/** Row counts per table, and max(seq) of the observation log (null when the database has none). */
export function describeDb(raw) {
  const tables = {};
  for (const t of tableNames(raw)) tables[t] = raw.prepare(`SELECT count(*) AS n FROM ${q(t)}`).get().n;
  const maxSeq =
    'observations' in tables ? (raw.prepare('SELECT max(seq) AS m FROM observations').get().m ?? 0) : null;
  return { maxSeq, tables };
}

/** Reads a manifest of every database in `dataDir`, read-only. */
export function buildManifest(dataDir) {
  const databases = {};
  for (const file of discoverDatabases(dataDir)) {
    const raw = new Database(join(dataDir, file), { readonly: true, fileMustExist: true });
    try {
      databases[file] = describeDb(raw);
    } finally {
      raw.close();
    }
  }
  return { version: 1, dataDir: resolve(dataDir), databases };
}

/** Exact match, or with `allowLag` restored may be behind the manifest but never ahead of it. */
function compare(expected, actual, allowLag, problems) {
  const differs = (want, got) => (allowLag ? got > want : got !== want);
  if (expected.maxSeq !== null && differs(expected.maxSeq, actual.maxSeq ?? -1)) {
    problems.push(`max(seq) is ${actual.maxSeq}, manifest says ${expected.maxSeq}`);
  }
  for (const [t, n] of Object.entries(expected.tables)) {
    const got = actual.tables[t];
    if (got === undefined) problems.push(`table ${t} is missing from the replica`);
    else if (differs(n, got)) problems.push(`table ${t} has ${got} rows, manifest says ${n}`);
  }
}

/**
 * Verifies one restored database file: integrity_check, check-only migration state, manifest comparison.
 * `migrations` are the server's migrations for this kind of database; `migrationState` is the server's read-only check.
 * Returns { file, ok, problems, stats }.
 */
export function verifyDb({ file, path, migrations, migrationState, manifestEntry, allowLag = false }) {
  const problems = [];
  let stats = null;
  let raw;
  try {
    raw = new Database(path, { readonly: true, fileMustExist: true });
    const integrity = raw.pragma('integrity_check').map((r) => r.integrity_check);
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      problems.push(`integrity_check failed: ${integrity.slice(0, 3).join('; ')}`);
    }
    const state = migrationState(raw, migrations);
    if (state.unknown.length)
      problems.push(`schema is newer than this server (migrations ${state.unknown.join(', ')})`);
    if (state.pending.length)
      problems.push(`pending migrations, not applied in check-only mode: ${state.pending.join(', ')}`);
    stats = describeDb(raw);
    if (manifestEntry) compare(manifestEntry, stats, allowLag, problems);
  } catch (e) {
    problems.push(`cannot read the restored database: ${e.message}`);
  } finally {
    raw?.close();
  }
  return { file, ok: problems.length === 0, problems, stats };
}

/** True when `path` is `dir` or inside it. */
export function isInside(path, dir) {
  const p = resolve(path);
  const d = resolve(dir);
  return p === d || p.startsWith(d + sep);
}

/** Names of the databases a file replica holds (one sub-directory per database file). */
export function listFileReplicaDbs(replicaDir) {
  if (!existsSync(replicaDir)) return [];
  return readdirSync(replicaDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('.db'))
    .map((e) => e.name)
    .sort();
}
