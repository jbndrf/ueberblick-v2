import { readFileSync } from 'node:fs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { tileUploadMax, type OverlayFile, type TemplateFile } from '@ueberblick/core';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { seedDraft } from '../../builder-draft';
import { openControlDb, openProjectDb } from '../../db/open';
import { controlTemplateSource, publishTemplate } from '../../templates';
import { draftTemplateFile } from './draft-file';
import { createTileUploads } from './service';
import { createDiskStore } from './store';
import { sweepStaleUploads } from './sweep';

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-01T08:00:00Z');

describe('sweepStaleUploads', () => {
  it('removes receiving uploads older than the limit, keeps younger ones and finished ones, and is idempotent', () => {
    dir = mkdtempSync(join(tmpdir(), 'tile-sweep-'));
    const store = createDiskStore((p) => join(dir as string, 'tiles', p));
    let now = T0;
    let n = 0;
    const uploads = createTileUploads({
      store,
      now: () => new Date(now).toISOString(),
      newId: () => (++n).toString(16).padStart(16, '0'),
    });
    const stale = uploads.start('demo', { kind: 'zip', name: 'alt', size: 10 });
    now += (tileUploadMax('stale_hours') - 1) * HOUR;
    const young = uploads.start('demo', { kind: 'zip', name: 'neu', size: 10 });
    now += 2 * HOUR;
    const errors: unknown[] = [];
    const deps = {
      store,
      now: () => new Date(now).toISOString(),
      onError: (...e: unknown[]) => errors.push(e),
    };
    expect(sweepStaleUploads(deps, ['demo', 'ohne-ordner'])).toBe(1);
    expect(store.readJob('demo', stale.id)).toBeUndefined();
    expect(existsSync(store.uploadDir('demo', young.id))).toBe(true);
    expect(store.readJob('demo', young.id)?.state).toBe('receiving');
    expect(sweepStaleUploads(deps, ['demo'])).toBe(0);
    expect(errors).toEqual([]);
  });

  it('reports a failure and carries on, never throws', () => {
    dir = mkdtempSync(join(tmpdir(), 'tile-sweep-'));
    const store = createDiskStore((p) => join(dir as string, 'tiles', p));
    const broken = {
      ...store,
      jobs: (p: string) => {
        if (p === 'kaputt') throw new Error('disk');
        return store.jobs(p);
      },
    };
    const errors: string[] = [];
    const deps = {
      store: broken,
      now: () => new Date(T0).toISOString(),
      onError: (p: string) => errors.push(p),
    };
    expect(sweepStaleUploads(deps, ['kaputt', 'demo'])).toBe(0);
    expect(errors).toEqual(['kaputt']);
  });
});

describe('draftTemplateFile', () => {
  it('is the merged file of the draft, and undefined without a draft or with an unparsable one', () => {
    const golden = <T>(rel: string): T =>
      embedGoldenRefs(
        parse(
          readFileSync(
            fileURLToPath(new URL(`../../../../../fixtures/golden/${rel}`, import.meta.url)),
            'utf8',
          ),
        ),
      ) as T;
    const control = openControlDb(':memory:');
    publishTemplate(control, golden<TemplateFile>('templates/baumkataster/1.0.0.yaml'), {
      now: () => '2026-10-01T08:00:00Z',
    });
    const templates = controlTemplateSource(control);
    const db = openProjectDb(':memory:', 'demo');
    expect(draftTemplateFile(db, templates)).toBeUndefined();
    const overlay = golden<OverlayFile>('projects/musterstadt-baeume.yaml');
    seedDraft(db, {
      template: 'baumkataster',
      templateVersion: '1.0.0',
      overlay: stringify(overlay),
      by: 'a',
      at: '2026-10-01T08:00:00Z',
    });
    expect(Object.keys(draftTemplateFile(db, templates)?.types ?? {}).length).toBeGreaterThan(0);
    db.prepare('UPDATE builder_draft SET overlay = ?').run(': : [');
    expect(draftTemplateFile(db, templates)).toBeUndefined();
  });
});
