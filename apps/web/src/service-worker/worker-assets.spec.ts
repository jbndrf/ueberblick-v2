import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { precacheList } from './routing';
import { listWorkerAssets } from './worker-assets';

describe('listWorkerAssets', () => {
  it('lists every file below the given folders as URL paths, and skips a missing folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-wa-'));
    mkdirSync(join(dir, '_app/immutable/workers'), { recursive: true });
    mkdirSync(join(dir, '_app/immutable/maplibre-gl-9.9.9'), { recursive: true });
    writeFileSync(join(dir, '_app/immutable/workers/sync.worker-AbC.js'), '');
    writeFileSync(join(dir, '_app/immutable/maplibre-gl-9.9.9/maplibre-gl-worker.mjs'), '');
    expect(
      listWorkerAssets(dir, ['_app/immutable/workers', '_app/immutable/maplibre-gl-9.9.9', 'nope']),
    ).toEqual([
      '/_app/immutable/workers/sync.worker-AbC.js',
      '/_app/immutable/maplibre-gl-9.9.9/maplibre-gl-worker.mjs',
    ]);
  });
});

describe('precacheList', () => {
  it('holds the build, the static files and the worker bundles, once each and without source maps', () => {
    const list = precacheList(
      ['/_app/a.js', '/_app/a.js.map'],
      ['/favicon.png'],
      ['/_app/immutable/workers/sync.worker-x.js', '/_app/a.js'],
    );
    expect(list).toEqual(['/_app/a.js', '/favicon.png', '/_app/immutable/workers/sync.worker-x.js']);
  });
});
