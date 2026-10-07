// WP-302/WP-130: the diffcheck store (core's MemoryStore) follows the server's semantics (union bbox per feature, edge contact, no deleted features).
import { readdirSync, readFileSync } from 'node:fs';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, NO_ASSETS, createGeo, merge, type FeatureId, type Key, type RunId } from '@ueberblick/core';
import { MemoryStore } from '@ueberblick/core/memory';
import { SIM_CONFIG_VERSION } from '@ueberblick/core/testing';
import { convertConfig } from '../config/convert';
import { loadFixture } from '../config/testing';
import { seedFeature } from './seed';

const config = (() => {
  const c = convertConfig(loadFixture('baumkontrolle'));
  const r = compile(merge(c.template, c.overlay).file, { assets: NO_ASSETS });
  if (!r.ok) throw new Error('fixture must compile');
  return r.config;
})();
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
const run = '10000000-0000-7000-8000-000000000001' as RunId;
const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });
const ids = (w: MemoryStore, x0: number, y0: number, x1: number, y1: number) =>
  [...w.near('baum' as Key, [x0, y0, x1, y1])].map((f) => f.id).sort();

describe('diffcheck store near', () => {
  const w = new MemoryStore(
    config,
    { now: () => '2023-11-14T22:13:20.000Z' },
    createGeo(),
    SIM_CONFIG_VERSION,
  );
  seedFeature(w, id(1), 'baum', { geom: point(1, 1) }, run);
  seedFeature(w, id(2), 'baum', { geom: point(5, 5) }, run);
  seedFeature(w, id(3), 'baum', {}, run);
  seedFeature(
    w,
    id(4),
    'flaeche',
    {
      geom: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      },
    },
    run,
  );

  it('finds features of the type inside the box, edge contact included', () => {
    expect(ids(w, 0, 0, 2, 2)).toEqual([id(1)]);
    expect(ids(w, 1, 1, 1, 1)).toEqual([id(1)]);
    expect(ids(w, 5, 5, 6, 6)).toEqual([id(2)]);
    expect(ids(w, 0, 0, 10, 10)).toEqual([id(1), id(2)]);
  });

  it('skips other types, features without geometry and empty areas', () => {
    expect(ids(w, 1.0001, 1.0001, 4, 4)).toEqual([]);
    expect([...w.near('flaeche' as Key, [2, 2, 3, 3])].map((f) => f.id)).toEqual([id(4)]);
  });

  it('skips deleted features', () => {
    w.append(run, [{ featureId: id(2), property: '$lifecycle', result: 'deleted' }]);
    expect(ids(w, 0, 0, 10, 10)).toEqual([id(1)]);
  });
});

describe('no second Facts implementation (R1)', () => {
  it('apps/migrate and packages/builder declare no class or object implementing Facts', () => {
    const roots = [
      new URL('..', import.meta.url),
      new URL('../../../../packages/builder/src/', import.meta.url),
    ];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        isPlanted(e.name)
          ? []
          : e.isDirectory()
            ? walk(join(dir, e.name))
            : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')
              ? [join(dir, e.name)]
              : [],
      );
    const hits = roots
      .flatMap((r) => walk(fileURLToPath(r)))
      .filter((f) => /implements\s+[\w, ]*\bFacts\b|\bnear\s*=\s*\(/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
