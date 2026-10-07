import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { deploy } from '../deploy';
import { migrate, migrationState } from '../db/migrate';
import { openControlDb, openProjectDb } from '../db/open';
import { PROJECT_MIGRATIONS } from '../db/project-schema';
import { controlTemplateSource, publishTemplate } from '../templates';
import { createDraftStore, createLayoutStore } from './index';

const golden = <T>(rel: string): T =>
  embedGoldenRefs(
    parse(
      readFileSync(fileURLToPath(new URL(`../../../../fixtures/golden/${rel}`, import.meta.url)), 'utf8'),
    ),
  ) as T;
const clock = { now: () => '2026-10-02T08:00:00Z' };

describe('canvas_layout (migration 23)', () => {
  it('is created once and a second migrate run is a no-op', () => {
    const db = openProjectDb(':memory:', 'demo');
    expect(PROJECT_MIGRATIONS.find((m) => m.id === 23)?.name).toBe('canvas_layout');
    expect(migrationState(db, PROJECT_MIGRATIONS).pending).toEqual([]);
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual([]);
    const store = createLayoutStore(db);
    store.replace('baum', [{ id: 'stage:a', x: 1, y: 2 }], 'admin', clock.now());
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual([]);
    expect(store.get('baum')).toEqual([{ id: 'stage:a', x: 1, y: 2 }]);
  });
});

describe('LayoutStore', () => {
  it('replace upserts the given nodes and prunes the others of that type only', () => {
    const store = createLayoutStore(openProjectDb(':memory:', 'demo'));
    store.replace(
      'baum',
      [
        { id: 'stage:a', x: 1, y: 2 },
        { id: 'global', x: -3.5, y: 4 },
      ],
      'admin',
      clock.now(),
    );
    store.replace('flaeche', [{ id: 'global', x: 9, y: 9 }], 'admin', clock.now());
    store.replace('baum', [{ id: 'stage:a', x: 10, y: 20 }], 'admin', clock.now());
    expect(store.get('baum')).toEqual([{ id: 'stage:a', x: 10, y: 20 }]);
    expect(store.get('flaeche')).toEqual([{ id: 'global', x: 9, y: 9 }]);
    expect(store.get('none')).toEqual([]);
  });

  it('property: a replace is read back exactly, whatever was stored before', () => {
    const node = fc.record({
      id: fc.string({ minLength: 1, maxLength: 20 }),
      x: fc.integer({ min: -1_000_000, max: 1_000_000 }).map((n) => n + 0.5),
      y: fc.integer({ min: -1_000_000, max: 1_000_000 }).map((n) => n + 0.25),
    });
    const uniq = fc.uniqueArray(node, { selector: (n) => n.id, maxLength: 12 });
    fc.assert(
      fc.property(uniq, uniq, (before, after) => {
        const store = createLayoutStore(openProjectDb(':memory:', 'demo'));
        store.replace('t', before, 'a', clock.now());
        store.replace('t', after, 'a', clock.now());
        const byId = (a: readonly { id: string }[]) => [...a].sort((p, q) => (p.id < q.id ? -1 : 1));
        expect(byId([...store.get('t')])).toEqual(byId(after));
      }),
      { numRuns: 40 },
    );
  });

  it('positions survive a publish, a rollback and a template upgrade (the draft reset)', () => {
    const control = openControlDb(':memory:');
    publishTemplate(control, golden<TemplateFile>('templates/baumkataster/1.0.0.yaml'), clock);
    const templates = controlTemplateSource(control);
    const db = openProjectDb(':memory:', 'demo');
    const store = createLayoutStore(db);
    const first = golden<OverlayFile>('projects/musterstadt-baeume.yaml');
    expect(deploy(db, first, 'a', { clock, templates }).ok).toBe(true);
    store.replace('baum', [{ id: 'stage:erfasst', x: 5, y: 6 }], 'a', clock.now());
    const stored = store.get('baum');

    const second = { ...first, name: 'Geändert' } as OverlayFile;
    expect(deploy(db, second, 'a', { clock, templates }).ok).toBe(true); // publish
    expect(deploy(db, first, 'a', { clock, templates }).ok).toBe(true); // rollback: the first file again
    createDraftStore(db).reset({
      template: 'baumkataster',
      templateVersion: '2.0.0',
      overlay: 'extends: baumkataster@2\n',
      by: 'a',
      at: clock.now(),
    }); // upgrade
    expect(store.get('baum')).toEqual(stored);
  });
});
