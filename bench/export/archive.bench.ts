/**
 * Budget (WP-384): the project ZIP of 10k features. Export streams (one page of rows in memory, `exportArchive`) and
 * must finish in <= 10 s with the first byte after <= 1 s and no memory growth with the project size; the import
 * (`importArchive`: every feature one `$seed` run, 200 per batch through the run store) takes <= 30 s, the budget of
 * the 10k CSV import it is derived from. CSV is measured as well (the data page's query, paged).
 * Run: npm run bench -- bench/export
 */
import { mkdtempSync, rmSync, statSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { FeatureId, Json } from '../../packages/core/src';
import { createBlobs, fileBlobStore } from '../../packages/server/src/blobs';
import { csvOfType } from '../../packages/server/src/http/admin-export/csv';
import { exportArchive } from '../../packages/server/src/io/archive/export-zip';
import { importArchive } from '../../packages/server/src/io/archive/import-zip';
import { fid, setup } from '../../packages/server/src/store/run/testkit';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const N = 10_000;

describe('bench: project ZIP export and import', () => {
  it('10k features: streamed export, CSV, and import into a new project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-export-'));
    try {
      const source = setup();
      source.seed(
        Array.from({ length: N }, (_, i) => ({
          id: fid(i + 1) as FeatureId,
          type: 'baum',
          properties: {
            stage: ['erfasst', 'kontrolliert', 'massnahme'][i % 3] as string,
            vitalitaet: `v${i % 5}`,
            hoehe_m: 5 + (i % 40),
            befund: `Befund ${i}, mit "Anführungszeichen"`,
            geometrie: {
              type: 'Point',
              coordinates: [7 + (i % 100) / 1000, 50 + Math.floor(i / 100) / 1000],
            } as unknown as Json,
          },
        })),
      );
      const blobs = createBlobs({
        db: source.db,
        store: fileBlobStore(join(dir, 'blobs')),
        clock: source.deps.clock,
      });
      const src = {
        db: source.db,
        project: { key: 'baeume', name: 'Bäume', description: '' },
        fileText: stringify(source.config.file),
        deployed: true,
        blobs,
        now: () => '2026-10-02T10:00:00.000Z',
      };

      const zipPath = join(dir, 'p.zip');
      const out = createWriteStream(zipPath);
      const rss0 = process.memoryUsage().rss;
      let peak = rss0;
      const t0 = performance.now();
      let firstMs = -1;
      for await (const chunk of exportArchive(src)) {
        if (firstMs < 0) firstMs = performance.now() - t0;
        if (!out.write(chunk)) await once(out, 'drain');
        peak = Math.max(peak, process.memoryUsage().rss);
      }
      out.end();
      await once(out, 'finish');
      const exportMs = performance.now() - t0;
      const growthMb = (peak - rss0) / 1e6;
      const mb = statSync(zipPath).size / 1e6;

      const c = csvOfType(source.db, 'baum', source.config.file.types?.['baum'] as never, null);
      if (!c.ok) throw new Error(c.message);
      const t1 = performance.now();
      let csvBytes = 0;
      for await (const part of c.chunks()) csvBytes += part.length;
      const csvMs = performance.now() - t1;

      const target = setup();
      const t2 = performance.now();
      const r = await importArchive(
        {
          createProject: (text) => ({ ok: true, key: 'neu', fileText: text }),
          putLive: () => ({ ok: true, version: 1 }),
          removeProject: () => undefined,
          usedTokens: () => new Set(),
          rosterTarget: () => {
            throw new Error('no roster');
          },
          store: () => target.store,
          blobs: () =>
            createBlobs({ db: target.db, store: fileBlobStore(join(dir, 't')), clock: target.deps.clock }),
          ids: target.deps.ids,
        },
        zipPath,
      );
      const importMs = performance.now() - t2;
      expect(r).toMatchObject({ ok: true, features: N });

      console.log(
        `project ZIP 10k: export ${exportMs.toFixed(0)} ms (first byte ${firstMs.toFixed(0)} ms, ${mb.toFixed(1)} MB, rss +${growthMb.toFixed(0)} MB), csv ${csvMs.toFixed(0)} ms (${(csvBytes / 1e6).toFixed(1)} MB), import ${importMs.toFixed(0)} ms`,
      );
      assertBudget(
        report(
          defineBudget({
            id: 'export-zip-10k',
            limit: 10,
            unit: 's',
            derivedFrom:
              'import-10k: an export reads the same rows once, streamed, 10k features in 10 s (WP-384)',
            device: 'server',
          }),
          exportMs / 1000,
        ),
      );
      assertBudget(
        report(
          defineBudget({
            id: 'export-zip-first-byte',
            limit: 1,
            unit: 's',
            derivedFrom: 'import-10k: the download starts before the data is read (WP-384)',
            device: 'server',
          }),
          firstMs / 1000,
        ),
      );
      assertBudget(
        report(
          defineBudget({
            id: 'export-zip-memory',
            limit: 100,
            unit: 'MB',
            derivedFrom:
              'import-10k: the stream holds one page, so memory does not follow the project size (WP-384)',
            device: 'measured',
          }),
          growthMb,
        ),
      );
      assertBudget(
        report(
          defineBudget({
            id: 'import-zip-10k',
            limit: 30,
            unit: 's',
            derivedFrom: 'import-10k: 10k features as $seed runs in batches of 200 (WP-384)',
            device: 'server',
          }),
          importMs / 1000,
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
