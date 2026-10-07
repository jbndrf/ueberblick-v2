import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { deployProject, previewKeys } from '@ueberblick/server';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { createRuntime, type Runtime } from '../runtime';
import { withSecurityHeaders } from './headers';
import { createMapOriginsStore, recomputeAfterDeploys } from './map-origins';

type File = Parameters<typeof deployProject>[1];
const base = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as Record<string, unknown> & { map: { layers: Record<string, unknown> } };

/** The golden template with its map layers replaced. */
const withLayers = (layers: Record<string, unknown>): File =>
  ({ ...base, map: { ...base.map, layers } }) as unknown as File;
const xyz = (url: string) => ({ label: 'x', kind: 'overlay', source: { type: 'xyz', url } });
const geojson = (url: string) => ({ label: 'g', kind: 'overlay', source: { type: 'geojson', url } });
const OSM = { label: 'osm', kind: 'base', source: { type: 'preset', preset: 'osm' } };

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-csp-'));
  dirs.push(dir);
  const rt = createRuntime({ dataDir: dir, secureCookies: false, sink: () => undefined });
  runtimes.push(rt);
  rt.control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('p1', 'demo', 'demo', 'x');
  const store = createMapOriginsStore({
    keys: () => [...rt.projectKeys(), ...previewKeys(rt.control)],
    db: rt.projectDb,
  });
  recomputeAfterDeploys(rt.services, store);
  const put = (file: File) =>
    deployProject(rt.projectDb('demo'), file, 'admin', {
      clock: rt.clock,
      templates: rt.templates,
      afterDeploy: () => rt.services.afterDeploy('demo'),
    });
  return { rt, store, put };
}

const directive = (csp: string, name: string): string =>
  csp.split(';').find((d) => d.trim().startsWith(name)) ?? '';

describe('map origins in the CSP (WP-957)', () => {
  it('is empty before any deploy; a deploy adds the host of a remote geojson layer only', () => {
    const { store, put } = world();
    expect(store.current()).toEqual([]);
    expect(put(withLayers({ osm: OSM, wetter: geojson('https://maps.example.org/a.geojson') })).ok).toBe(
      true,
    );
    expect(store.current()).toEqual(['https://maps.example.org']);
  });

  it('WP-971: layers the tile proxy serves (preset, xyz, wms, pmtiles) add no upstream host to the CSP', () => {
    const { store, put } = world();
    const wms = {
      label: 'w',
      kind: 'overlay',
      source: { type: 'wms', url: 'https://wms.example.org/s', layers: 'a' },
    };
    const pm = {
      label: 'p',
      kind: 'overlay',
      source: { type: 'pmtiles', url: 'https://cdn.example.org/a.pmtiles' },
    };
    expect(
      put(withLayers({ osm: OSM, a: xyz('https://maps.example.org/{z}/{x}/{y}.png'), w: wms, p: pm })).ok,
    ).toBe(true);
    expect(store.current()).toEqual([]);
  });

  it('page CSP (nonce kept) and an API response both carry the origins in connect-src and img-src', () => {
    const { store, put } = world();
    put(withLayers({ osm: OSM, wetter: geojson('https://maps.example.org/a.geojson') }));
    const page = new Response('<html>', {
      headers: {
        'content-security-policy':
          "default-src 'self'; img-src 'self' data:; connect-src 'self'; script-src 'self' 'nonce-abc'",
      },
    });
    const api = Response.json({ ok: true });
    for (const res of [page, api]) {
      const csp =
        withSecurityHeaders(res, false, store.current()).headers.get('content-security-policy') ?? '';
      for (const d of ['connect-src', 'img-src']) {
        expect(directive(csp, d)).toContain('https://maps.example.org');
        expect(directive(csp, d)).not.toContain('https://tile.openstreetmap.org');
      }
      expect(directive(csp, 'script-src')).not.toContain('example.org');
    }
    expect(page.headers.get('content-security-policy')).toContain("'nonce-abc'");
  });

  it('a layer removed by the next deploy loses its host', () => {
    const { store, put } = world();
    put(withLayers({ osm: OSM, wetter: geojson('https://maps.example.org/a.geojson') }));
    put(withLayers({ osm: OSM }));
    expect(store.current()).toEqual([]);
  });

  it('a start over existing projects computes the set from the deployed configs', () => {
    const { rt, store, put } = world();
    put(withLayers({ wetter: geojson('https://maps.example.org/a.geojson') }));
    const fresh = createMapOriginsStore({ keys: rt.projectKeys, db: rt.projectDb });
    expect(fresh.current()).toEqual(store.current());
  });

  it('a hostile layer url never widens the policy', () => {
    const { store, put } = world();
    put(withLayers({ bad: geojson('https://*.example.org/a.geojson') }));
    expect(store.current()).toEqual([]);
  });
});
