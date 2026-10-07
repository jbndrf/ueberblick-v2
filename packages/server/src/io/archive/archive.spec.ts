// WP-384: the project ZIP. Export -> import gives a project whose fold equals the original, through runs only (R3).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { LIFECYCLE_TASK, SEED_TASK, type FeatureId, type Json, type Key } from '@ueberblick/core';
import { createBlobs, fileBlobStore } from '../../blobs';
import type { Db } from '../../db/driver';
import { setup, type Ctx } from '../../store/run/testkit';
import { SYSTEM_ACTOR } from '../../timers/fire';
import { exportArchive, type ArchiveSource } from './export-zip';
import { importArchive, type ArchiveImportDeps } from './import-zip';
import { ARCHIVE_ENTRIES, ARCHIVE_ZIP_LIMITS } from './manifest';
import { openZip, zipStream } from './zip';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'archive-spec-'));
  dirs.push(d);
  return d;
};

const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });
const square = {
  type: 'Polygon',
  coordinates: [
    [
      [10.0, 51.0],
      [10.1, 51.0],
      [10.1, 51.1],
      [10.0, 51.1],
      [10.0, 51.0],
    ],
  ],
};

function seedRun(ctx: Ctx, type: string, id: FeatureId, values: Record<string, Json>) {
  return ctx.run(SEED_TASK, SYSTEM_ACTOR, { type, values }, id);
}

function populate(ctx: Ctx, blobSha: string): void {
  const f = (n: number): FeatureId => `0000000${n}-0000-7000-8000-000000000001` as FeatureId;
  const runs = [
    seedRun(ctx, 'baumart', f(1), { name_de: 'Linde', name_lat: 'Tilia' }),
    seedRun(ctx, 'flaeche', f(2), { name: 'Park', geometrie: square as Json }),
    seedRun(ctx, 'baum', f(3), {
      geometrie: point(10.05, 51.05) as Json,
      art: f(1),
      stage: 'kontrolliert',
      vitalitaet: 'v2',
      hoehe_m: 12.5,
      befund: 'Ümlaut, "quote"; comma',
      beschreibung: { de: 'Alt', en: 'Old' },
      foto: [{ sha256: blobSha, name: 'a.png', mime: 'image/png' }] as Json,
    }),
    seedRun(ctx, 'baum', f(4), { geometrie: point(10.06, 51.06) as Json, stage: 'massnahme' }),
    seedRun(ctx, 'baum', f(5), { geometrie: point(10.07, 51.07) as Json }),
    ctx.run(LIFECYCLE_TASK, SYSTEM_ACTOR, { state: 'archived' }, f(4)),
    ctx.run(LIFECYCLE_TASK, SYSTEM_ACTOR, { state: 'deleted' }, f(5)),
  ];
  for (const r of runs) {
    const out = ctx.store.submit(r);
    if (out.outcome !== 'accepted') throw new Error(`${r.task}: ${out.refusal.message}`);
  }
}

const fold = (db: Db) => ({
  features: db
    .prepare<Record<string, unknown>>(
      'SELECT id, type, lifecycle, properties, geometry, anchor_lon, anchor_lat, area_m2 FROM features ORDER BY id',
    )
    .all(),
  edges: db
    .prepare<Record<string, unknown>>(
      'SELECT from_id, relation, to_id, derived FROM edges ORDER BY from_id, relation, to_id',
    )
    .all(),
});

async function world() {
  const dir = tmp();
  const source = setup();
  const target = setup();
  const sBlobs = createBlobs({
    db: source.db,
    store: fileBlobStore(join(dir, 's')),
    clock: source.deps.clock,
  });
  const tBlobs = createBlobs({
    db: target.db,
    store: fileBlobStore(join(dir, 't')),
    clock: target.deps.clock,
  });
  const png = Buffer.from('not-really-a-png-but-bytes');
  const stored = await sBlobs.put(
    (async function* () {
      yield png;
    })(),
    'image/png',
  );
  populate(source, stored.sha256);
  const src: ArchiveSource = {
    db: source.db,
    project: { key: 'baeume', name: 'Bäume', description: 'Test' },
    fileText: stringify(source.config.file),
    deployed: true,
    blobs: sBlobs,
    now: () => '2026-10-02T10:00:00.000Z',
  };
  const zipPath = join(dir, 'p.zip');
  const parts: Buffer[] = [];
  for await (const c of exportArchive(src)) parts.push(Buffer.from(c));
  writeFileSync(zipPath, Buffer.concat(parts));
  const created: { text: string; name: string | undefined }[] = [];
  const removed: string[] = [];
  const deps: ArchiveImportDeps = {
    createProject: (text, name) => {
      created.push({ text, name });
      return { ok: true, key: 'neu', fileText: text };
    },
    putLive: () => ({ ok: true, version: 1 }),
    removeProject: (key) => void removed.push(key),
    usedTokens: () => new Set(),
    rosterTarget: () => {
      throw new Error('no roster');
    },
    store: () => target.store,
    blobs: () => tBlobs,
    ids: target.deps.ids,
  };
  return { source, target, src, zipPath, deps, created, removed, stored, tBlobs, png, dir };
}

describe('project ZIP', () => {
  it('export -> import gives a project whose fold equals the original', async () => {
    const w = await world();
    const progress: [number, number][] = [];
    const r = await importArchive(
      { ...w.deps, progress: (d, t) => progress.push([d, t]) },
      w.zipPath,
      'Kopie',
    );
    expect(r).toEqual({ ok: true, key: 'neu', features: 5, blobs: 1 });
    expect(fold(w.target.db)).toEqual(fold(w.source.db));
    expect(w.created[0]?.name).toBe('Kopie');
    expect(progress[0]).toEqual([0, 6]);
    expect(progress.at(-1)).toEqual([6, 6]);
    // the blob came with it, byte for byte
    const got = w.tBlobs.get(w.stored.sha256);
    const bytes: Buffer[] = [];
    for await (const c of got?.stream ?? []) bytes.push(Buffer.from(c));
    expect(Buffer.concat(bytes).equals(w.png)).toBe(true);
  });

  it('enters data only through runs: every feature is a $seed run, lifecycles are $lifecycle runs', async () => {
    const w = await world();
    await importArchive(w.deps, w.zipPath);
    const tasks = w.target.db
      .prepare<{ task: string; n: number }>(
        'SELECT task, count(*) AS n FROM runs GROUP BY task ORDER BY task',
      )
      .all();
    expect(tasks).toEqual([
      { task: LIFECYCLE_TASK, n: 2 },
      { task: SEED_TASK, n: 5 },
    ]);
  });

  it('holds a manifest with the format version, the counts, the file and one data entry per type', async () => {
    const w = await world();
    const zip = await openZip(w.zipPath, ARCHIVE_ZIP_LIMITS);
    const manifest = JSON.parse(await zip.text(ARCHIVE_ENTRIES.manifest)) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      format: 'ueberblick-project-zip',
      version: 2,
      deployed: true,
      project: { key: 'baeume', name: 'Bäume' },
      types: { baum: { count: 3 }, baumart: { count: 1 }, flaeche: { count: 1 } },
      blobs: { count: 1 },
    });
    expect(zip.has(ARCHIVE_ENTRIES.file)).toBe(true);
    expect(zip.has(ARCHIVE_ENTRIES.blob(w.stored.sha256))).toBe(true);
    expect((await zip.text(ARCHIVE_ENTRIES.data('baum'))).trim().split('\n')).toHaveLength(3);
  });

  it('imports an archive whose features still hold a discarded property (WP-1071)', async () => {
    const w = await world();
    // a deploy that discarded a property keeps its values in the fold; the export carries them
    w.source.db
      .prepare(
        "UPDATE features SET properties = json_set(properties, '$.baum_nr', '10000') WHERE type = 'baum'",
      )
      .run();
    const parts: Buffer[] = [];
    for await (const c of exportArchive(w.src)) parts.push(Buffer.from(c));
    const path = join(w.dir, 'd.zip');
    writeFileSync(path, Buffer.concat(parts));
    expect(await importArchive(w.deps, path)).toEqual({ ok: true, key: 'neu', features: 5, blobs: 1 });
    const rows = w.target.db
      .prepare<{ properties: string }>("SELECT properties FROM features WHERE type = 'baum'")
      .all();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.properties.includes('baum_nr'))).toBe(true);
  });

  it('an erased value is not exported (B-005): the folded property is gone', async () => {
    const w = await world();
    // an erasure leaves the property blank in the fold; the export reads the fold
    w.source.db
      .prepare("UPDATE features SET properties = json_remove(properties, '$.befund') WHERE type = 'baum'")
      .run();
    const parts: Buffer[] = [];
    for await (const c of exportArchive(w.src)) parts.push(Buffer.from(c));
    const path = join(w.dir, 'e.zip');
    writeFileSync(path, Buffer.concat(parts));
    expect(await (await openZip(path, ARCHIVE_ZIP_LIMITS)).text(ARCHIVE_ENTRIES.data('baum'))).not.toContain(
      'Ümlaut',
    );
  });

  it('a project that was never deployed exports its file and no data, and imports as a draft', async () => {
    const w = await world();
    const parts: Buffer[] = [];
    for await (const c of exportArchive({ ...w.src, deployed: false })) parts.push(Buffer.from(c));
    const path = join(w.dir, 'draft.zip');
    writeFileSync(path, Buffer.concat(parts));
    const deployCalls: string[] = [];
    const r = await importArchive(
      { ...w.deps, putLive: (k) => (deployCalls.push(k), { ok: true, version: 1 }) },
      path,
    );
    expect(r).toEqual({ ok: true, key: 'neu', features: 0, blobs: 0 });
    expect(deployCalls).toEqual([]);
  });

  it.each([
    [
      'a file that is no ZIP',
      async (w: Awaited<ReturnType<typeof world>>) => {
        const p = join(w.dir, 'x.zip');
        writeFileSync(p, 'hello');
        return p;
      },
    ],
    [
      'a ZIP without a manifest',
      async (w: Awaited<ReturnType<typeof world>>) => {
        const p = join(w.dir, 'y.zip');
        const parts: Buffer[] = [];
        for await (const c of zipStream([
          {
            name: 'a.txt',
            data: (async function* () {
              yield Buffer.from('x');
            })(),
          },
        ]))
          parts.push(Buffer.from(c));
        writeFileSync(p, Buffer.concat(parts));
        return p;
      },
    ],
  ])('refuses %s and creates nothing', async (_n, make) => {
    const w = await world();
    const r = await importArchive(w.deps, await make(w));
    expect(r.ok).toBe(false);
    expect(w.created).toEqual([]);
  });

  it('refuses a newer format version', async () => {
    const w = await world();
    const entries = async function* () {
      yield {
        name: ARCHIVE_ENTRIES.manifest,
        data: (async function* () {
          yield Buffer.from(
            JSON.stringify({
              format: 'ueberblick-project-zip',
              version: 99,
              exportedAt: 'x',
              project: { key: 'a', name: 'a', description: '' },
              deployed: false,
              types: {},
              blobs: { count: 0, bytes: 0 },
            }),
          );
        })(),
      };
      yield {
        name: ARCHIVE_ENTRIES.file,
        data: (async function* () {
          yield Buffer.from('a: 1');
        })(),
      };
    };
    const parts: Buffer[] = [];
    for await (const c of zipStream(entries())) parts.push(Buffer.from(c));
    const p = join(w.dir, 'v99.zip');
    writeFileSync(p, Buffer.concat(parts));
    const r = await importArchive(w.deps, p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]?.message).toContain('99');
    expect(w.created).toEqual([]);
  });

  it('reports a refused feature with its id and removes the project it created', async () => {
    const w = await world();
    const bad = setup();
    bad.db.exec('DELETE FROM config_versions');
    const r = await importArchive(
      {
        ...w.deps,
        store: () =>
          ({
            ...bad.store,
            submitBatch: () => ({
              outcome: 'refused',
              index: 0,
              runId: 'r' as never,
              refusal: { code: 'invalid_input', message: 'nope' },
            }),
          }) as never,
      },
      w.zipPath,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r).not.toHaveProperty('key');
      expect(r.problems[0]?.message).toContain('nope');
    }
    expect(w.removed).toEqual(['neu']);
  });

  it('a removal that throws is reported to onCleanupError and does not throw', async () => {
    const w = await world();
    const heard: string[] = [];
    const r = await importArchive(
      {
        ...w.deps,
        putLive: () => ({ ok: false, problems: [{ path: 'project.yaml', message: 'no' }] }),
        removeProject: () => {
          throw new Error('disk');
        },
        onCleanupError: (key) => void heard.push(key),
      },
      w.zipPath,
    );
    expect(r.ok).toBe(false);
    expect(heard).toEqual(['neu']);
  });

  it('a project is not removed when the import succeeds', async () => {
    const w = await world();
    expect((await importArchive(w.deps, w.zipPath)).ok).toBe(true);
    expect(w.removed).toEqual([]);
    expect(Object.keys({} as Record<Key, never>)).toEqual([]);
  });
});
