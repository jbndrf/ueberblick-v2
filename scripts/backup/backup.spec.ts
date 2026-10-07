import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACTOR_KINDS, RUN_OUTCOMES } from '@ueberblick/core';
import { openControlDb, openProjectDb } from '../../packages/server/src/db/open';
import { discoverDatabases, generateConfig } from './config.mjs';
import { formatReport, runDrill } from './drill.mjs';
import { expectedMigrations } from './expected.mjs';
import { installHint, LITESTREAM_SHA256, LITESTREAM_VERSION, releaseUrl } from './litestream.mjs';
import { buildManifest } from './verify.mjs';
import { specEnv } from '../testing/spec-env.mjs';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-backup-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Pinned Litestream: uses one already on PATH at the pinned version, else downloads it once into ~/.cache. */
async function ensureBinaryDir(): Promise<string> {
  const cache = join(homedir(), '.cache', 'ueberblick', `litestream-${LITESTREAM_VERSION}`);
  const bin = join(cache, 'litestream');
  if (existsSync(bin)) return cache;
  const platform = `${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
  const want = (LITESTREAM_SHA256 as Record<string, string>)[platform];
  if (!want)
    throw new Error(`no pinned Litestream build for ${platform}; install it by hand (${installHint()})`);
  const res = await fetch(releaseUrl(platform));
  if (!res.ok)
    throw new Error(
      `cannot download Litestream ${LITESTREAM_VERSION}: HTTP ${res.status}. Report to the lead (no network?)`,
    );
  const buf = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(buf).digest('hex') !== want)
    throw new Error('Litestream download failed its sha256 check');
  mkdirSync(cache, { recursive: true });
  const tgz = join(cache, 'ls.tgz');
  writeFileSync(tgz, buf);
  execFileSync('tar', ['xzf', tgz, '-C', cache, 'litestream'], { env: specEnv() });
  rmSync(tgz);
  return cache;
}

let binDir = '';
const PATH_WITH = (): string => `${binDir}:${process.env.PATH ?? ''}`;
let expected: ReturnType<typeof expectedMigrations>;
beforeAll(async () => {
  binDir = await ensureBinaryDir();
  expected = expectedMigrations();
}, 120_000);

const WAIT_TIMEOUT_MS = 90_000;
/** Polls `check` until it returns null (done) or the timeout passes; the error names what was awaited and the last state. */
async function waitFor(what: string, check: () => string | null, timeoutMs = WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = check();
  while (last !== null) {
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}. Last state: ${last}`);
    await new Promise((r) => setTimeout(r, 100));
    last = check();
  }
}

function seedProject(dir: string, key: string, runs: number): ReturnType<typeof openProjectDb> {
  const db = openProjectDb(dir, key);
  addRuns(db, 0, runs);
  return db;
}
function addRuns(db: ReturnType<typeof openProjectDb>, from: number, count: number): void {
  for (let i = from; i < from + count; i++) {
    db.prepare(
      "INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome) VALUES (?, 'a', ?, 't', 1, '{}', 'now', ?)",
    ).run(`run-${i}`, ACTOR_KINDS.keys[0], RUN_OUTCOMES.keys[0]);
    db.prepare('INSERT INTO observations (run_id, feature_id, property, result) VALUES (?, ?, ?, ?)').run(
      `run-${i}`,
      `f-${i}`,
      'p',
      '1',
    );
  }
}

/** Runs `litestream replicate` until every database has WAL segments in its replica, then stops it cleanly. */
async function replicate(dataDir: string, replicaDir: string, more: () => void): Promise<void> {
  const cfg = join(tmp(), 'litestream.yml');
  writeFileSync(cfg, generateConfig({ dataDir, replicaBase: `file://${replicaDir}`, syncInterval: '100ms' }));
  const child = spawn(join(binDir, 'litestream'), ['replicate', '-config', cfg], {
    stdio: 'ignore',
    env: specEnv(),
  });
  const hasSnapshot = (db: string): boolean =>
    existsSync(join(replicaDir, db, 'generations')) &&
    readdirSync(join(replicaDir, db, 'generations')).length > 0;
  const dbs = discoverDatabases(dataDir);
  const exited = new Promise<number | null>((r) => child.once('exit', r));
  let died: number | null | undefined;
  void exited.then((c) => (died = c));
  const alive = (): string | null => (died === undefined ? null : `litestream exited early (code ${died})`);
  await waitFor(
    'a snapshot of every database in the replica',
    () =>
      alive() ??
      (dbs.every((d) => existsSync(join(replicaDir, d)) && hasSnapshot(d)) ? null : 'no snapshot yet'),
  );
  more();
  // Wait until the replica restores to exactly the live state (same max(seq) and row counts per database).
  const want = buildManifest(dataDir);
  const scratchParent = tmp();
  await waitFor(`the replica to reach the live state (max(seq) ${describeWant(want)})`, () => {
    const dead = alive();
    if (dead) return dead;
    const report = runDrill({
      replica: `file://${replicaDir}`,
      manifest: want,
      expected,
      pathEnv: PATH_WITH(),
      scratchParent,
    });
    return report.ok ? null : formatReport(report);
  });
  child.kill('SIGINT');
  await exited;
}

const describeWant = (m: ReturnType<typeof buildManifest>): string =>
  Object.entries(m.databases)
    .map(([f, d]) => `${f}=${d.maxSeq}`)
    .join(', ');

describe('config generator', () => {
  it('covers control.db and every project database, found by scanning (no hand-kept list)', () => {
    const dir = tmp();
    openControlDb(join(dir, 'control.db')).close();
    seedProject(dir, 'baum', 1).close();
    expect(discoverDatabases(dir)).toEqual(['control.db', 'project-baum.db']);
    seedProject(dir, 'maengel', 1).close();
    const yml = generateConfig({ dataDir: dir, replicaBase: 's3://bucket/prod' });
    expect(discoverDatabases(dir)).toContain('project-maengel.db');
    for (const f of ['control.db', 'project-baum.db', 'project-maengel.db']) {
      expect(yml).toContain(`path: ${join(dir, f)}`);
      expect(yml).toContain(`url: s3://bucket/prod/${f}`);
    }
    expect(yml).not.toContain('-wal');
  });
  it('refuses a directory without control.db', () => {
    expect(() => discoverDatabases(tmp())).toThrow(/control\.db/);
  });
});

describe('restore drill (real Litestream, file replica)', () => {
  async function setup(): Promise<{
    live: string;
    replica: string;
    manifest: ReturnType<typeof buildManifest>;
  }> {
    const live = tmp();
    const replica = tmp();
    const control = openControlDb(join(live, 'control.db'));
    const project = seedProject(live, 'baum', 20);
    const other = seedProject(live, 'maengel', 5);
    await replicate(live, replica, () => {
      addRuns(project, 20, 10);
      addRuns(other, 5, 3);
      control
        .prepare("INSERT INTO projects (id, key, name, created_at) VALUES ('p1', 'baum', 'Baum', 'now')")
        .run();
    });
    control.close();
    project.close();
    other.close();
    return { live, replica, manifest: buildManifest(live) };
  }

  it('restores and verifies with matching counts, and never writes to the live directory', async () => {
    const { live, replica, manifest } = await setup();
    const before = readdirSync(live).map((f) => [f, statSync(join(live, f)).mtimeMs]);
    const report = runDrill({ replica: `file://${replica}`, manifest, expected, pathEnv: PATH_WITH() });
    expect(report.ok, formatReport(report)).toBe(true);
    expect(report.results.map((r) => r.file)).toEqual([
      'control.db',
      'project-baum.db',
      'project-maengel.db',
    ]);
    expect(report.results.find((r) => r.file === 'project-baum.db')?.stats?.maxSeq).toBe(30);
    expect(readdirSync(live).map((f) => [f, statSync(join(live, f)).mtimeMs])).toEqual(before);
    expect(formatReport(report)).toContain('DRILL PASSED');
  }, 60_000);

  it('works without a manifest by listing a file replica', async () => {
    const { replica } = await setup();
    const report = runDrill({ replica: `file://${replica}`, expected, pathEnv: PATH_WITH() });
    expect(report.ok, formatReport(report)).toBe(true);
    expect(report.results).toHaveLength(3);
  }, 60_000);

  it('fails loudly when the manifest disagrees with the replica', async () => {
    const { replica, manifest } = await setup();
    manifest.databases['project-baum.db'] = { maxSeq: 99, tables: { observations: 99 } };
    const report = runDrill({ replica: `file://${replica}`, manifest, expected, pathEnv: PATH_WITH() });
    expect(report.ok).toBe(false);
    expect(formatReport(report)).toMatch(/max\(seq\) is 30, manifest says 99/);
    expect(formatReport(report)).toContain('DRILL FAILED');
  }, 60_000);

  it('fails loudly on a truncated or corrupted replica', async () => {
    const { replica, manifest } = await setup();
    const gen = join(replica, 'project-baum.db', 'generations');
    const snap = join(gen, String(readdirSync(gen)[0]), 'snapshots');
    const file = join(snap, String(readdirSync(snap)[0]));
    truncateSync(file, Math.floor(statSync(file).size / 2));
    const report = runDrill({ replica: `file://${replica}`, manifest, expected, pathEnv: PATH_WITH() });
    expect(report.ok).toBe(false);
    const bad = report.results.find((r) => r.file === 'project-baum.db');
    expect(bad?.ok).toBe(false);
    expect(bad?.problems.length).toBeGreaterThan(0);
    expect(report.results.find((r) => r.file === 'control.db')?.ok).toBe(true);
  }, 60_000);

  it('fails when a replicated database is absent from the replica', async () => {
    const { replica, manifest } = await setup();
    rmSync(join(replica, 'project-maengel.db'), { recursive: true });
    const report = runDrill({ replica: `file://${replica}`, manifest, expected, pathEnv: PATH_WITH() });
    expect(report.ok).toBe(false);
    expect(report.results.find((r) => r.file === 'project-maengel.db')?.problems[0]).toMatch(
      /restore failed/,
    );
  }, 60_000);

  it('refuses to restore inside the live data directory', async () => {
    const { live, replica, manifest } = await setup();
    const report = runDrill({
      replica: `file://${replica}`,
      manifest,
      expected,
      pathEnv: PATH_WITH(),
      scratchParent: join(live, 'scratch'),
    });
    expect(report.ok).toBe(false);
    expect(report.fatal).toMatch(/live data directory/);
    expect(existsSync(join(live, 'scratch'))).toBe(false);
  }, 60_000);
});

describe('missing binary', () => {
  it('says how to install the pinned version (fake PATH, no silent skip)', () => {
    const empty = tmp();
    const fake = tmp();
    writeFileSync(join(fake, 'litestream'), 'not executable');
    chmodSync(join(fake, 'litestream'), 0o644);
    const report = runDrill({
      replica: 'file:///nowhere',
      expected,
      pathEnv: `${empty}:${fake}`,
    });
    expect(report.ok).toBe(false);
    expect(report.fatal).toContain(`Litestream ${LITESTREAM_VERSION}`);
    expect(report.fatal).toContain('releases/download');
    expect(formatReport(report)).toContain('DRILL FAILED');
  });
});

describe('expected migrations', () => {
  it('reads the ids from the server schema modules', () => {
    expect(expected.control.length).toBeGreaterThan(0);
    expect(expected.project[0]?.id).toBe(1);
  });
  it('reads the manifest file format back', () => {
    const live = tmp();
    openControlDb(join(live, 'control.db')).close();
    const m = buildManifest(live);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(m.databases['control.db']?.maxSeq).toBeNull();
    expect(readFileSync(join(live, 'control.db')).length).toBeGreaterThan(0);
  });
});
