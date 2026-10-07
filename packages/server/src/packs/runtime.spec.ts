import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { openProjectDb } from '../db/open';
import { deployProject } from '../deploy/deploy-project';
import { deployedVersion, loadData } from '../deploy/versions';
import type { FetchRange } from './fetch';
import { layerFile } from './build';
import { pinnedPackHashes } from './pinned';
import { createPackBuilder } from './builder';
import { createPackRuntime } from './runtime';
import { packTargets, rowsOf, storedHashes } from './store';
import { fixtureArchive, must, packFile, serve } from './testkit';

const NOW = '2026-10-02T10:00:00.000Z';
const clock = { now: () => NOW };
const defs = {
  innen: { bounds: [7.08, 50.7, 7.14, 50.75] as [number, number, number, number], min_zoom: 2, max_zoom: 6 },
};
let archive: Uint8Array;
beforeAll(async () => {
  archive = await fixtureArchive(5);
});

/** A fetch that holds every call until `release()`, so a test can act while a drain is mid-build. */
function gated(bytes: Uint8Array) {
  const inner = serve(bytes);
  let open = false;
  const waiting: (() => void)[] = [];
  let first!: () => void;
  const started = new Promise<void>((r) => (first = r));
  const fetchRange: FetchRange = async (url, offset, length) => {
    first();
    if (!open) await new Promise<void>((r) => waiting.push(r));
    return inner.fetchRange(url, offset, length);
  };
  return {
    fetchRange,
    calls: inner.calls,
    started,
    release: () => {
      open = true;
      waiting.splice(0).forEach((r) => r());
    },
  };
}

function world(enabled = true, fetchRange: FetchRange = serve(archive).fetchRange) {
  const db = openProjectDb(':memory:', 'demo');
  const deploy = (file: TemplateFile) =>
    deployProject(db, file, 'admin', { clock, afterDeploy: () => undefined });
  deploy(packFile(defs));
  const dir = mkdtempSync(join(tmpdir(), 'pr-'));
  const errors: string[] = [];
  const rt = createPackRuntime({
    enabled,
    clock,
    fetchRange,
    projectDb: () => db,
    file: () => must(loadData(db, must(deployedVersion(db)).version)).file,
    dir: () => dir,
    onError: (_k, i) => errors.push(i.code),
  });
  return { db, dir, rt, deploy, errors };
}

describe('pack runtime', () => {
  it('a kick after a deploy queues and builds the new pack', async () => {
    const w = world();
    w.rt.kick('demo');
    await w.rt.idle();
    const hash = must(packTargets(packFile(defs))[0]).hash;
    expect(rowsOf(w.db, [hash]).map((r) => r.state)).toEqual(['ready']);
    expect(existsSync(layerFile(w.dir, hash, 'basis'))).toBe(true);
    // a changed pack is another hash: the next kick builds it and sweeps the old one
    w.deploy(packFile({ innen: { ...defs.innen, max_zoom: 5 } }));
    w.rt.kick('demo');
    await w.rt.idle();
    const next = must(packTargets(packFile({ innen: { ...defs.innen, max_zoom: 5 } }))[0]).hash;
    expect(storedHashes(w.db)).toEqual([next]);
    expect(w.errors).toEqual([]);
  });

  it('a kick during a drain does not start a parallel drain, and runs again afterwards', async () => {
    const baseline = gated(archive);
    const b = world(true, baseline.fetchRange);
    b.rt.kick('demo');
    await baseline.started;
    baseline.release();
    await b.rt.idle();
    const expectedCalls = baseline.calls.length;

    const g = gated(archive);
    const w = world(true, g.fetchRange);
    w.rt.kick('demo');
    await g.started;
    w.rt.kick('demo'); // while the first drain is in flight
    w.rt.kick('demo');
    w.deploy(packFile({ ...defs, aussen: { ...defs.innen, bounds: [8, 51, 8.1, 51.1] } }));
    w.rt.kick('demo'); // the deploy's kick: marks "run again"
    g.release();
    await w.rt.idle();
    // the first pack was built once (no second drain read its header again); the new pack by the "again" pass
    const hashes = packTargets(packFile({ ...defs, aussen: { ...defs.innen, bounds: [8, 51, 8.1, 51.1] } }));
    expect(hashes.flatMap((t) => rowsOf(w.db, [t.hash]).map((r) => r.state))).toEqual(['ready', 'ready']);
    expect(g.calls.filter(([o]) => o === 0).length).toBe(2 * baseline.calls.filter(([o]) => o === 0).length);
    expect(expectedCalls).toBeGreaterThan(0);
  });

  it('shutdown aborts the drain and leaves the row to resume', async () => {
    const g = gated(archive);
    const w = world(true, g.fetchRange);
    w.rt.kick('demo');
    await g.started;
    w.rt.stop();
    g.release();
    await w.rt.idle();
    const hash = must(packTargets(packFile(defs))[0]).hash;
    expect(rowsOf(w.db, [hash]).map((r) => r.state)).toEqual(['building']);
    w.rt.kick('demo'); // after stop nothing starts
    await w.rt.idle();
    expect(rowsOf(w.db, [hash]).map((r) => r.state)).toEqual(['building']);
  });

  it('builds and queues nothing when switched off', async () => {
    const g = gated(archive);
    const w = world(false, g.fetchRange);
    w.rt.kick('demo');
    await w.rt.idle();
    expect(g.calls).toEqual([]);
    expect(storedHashes(w.db).length).toBe(1); // only the deploy's own queue rows
    expect(rowsOf(w.db, storedHashes(w.db)).map((r) => r.state)).toEqual(['queued']);
  });
});

describe('garbage collection and pinned versions', () => {
  it('keeps a hash only a pinned version uses, and removes it once nothing pins that version', async () => {
    const db = openProjectDb(':memory:', 'demo');
    const deploy = (f: TemplateFile) =>
      deployProject(db, f, 'admin', { clock, afterDeploy: () => undefined });
    deploy(packFile(defs));
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    const builder = createPackBuilder({
      db,
      dir,
      clock,
      fetchRange: serve(archive).fetchRange,
      file: () => must(loadData(db, must(deployedVersion(db)).version)).file,
      pinned: () => pinnedPackHashes(db),
    });
    await builder.drain();
    const oldHash = must(packTargets(packFile(defs))[0]).hash;
    db.prepare(
      `INSERT INTO features (id, type, config_version, properties, updated_seq, pinned_version) VALUES ('f1', 't', 1, '{}', 1, 1)`,
    ).run();
    deploy(packFile({ innen: { ...defs.innen, max_zoom: 5 } }));
    await builder.drain();
    expect(storedHashes(db)).toContain(oldHash);
    expect(existsSync(layerFile(dir, oldHash, 'basis'))).toBe(true);
    db.prepare('UPDATE features SET pinned_version = NULL').run();
    await builder.drain();
    expect(storedHashes(db)).not.toContain(oldHash);
    expect(existsSync(layerFile(dir, oldHash, 'basis'))).toBe(false);
  });
});
