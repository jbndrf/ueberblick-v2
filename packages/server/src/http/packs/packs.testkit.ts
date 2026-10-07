/** A built project for the pack endpoints: two pmtiles layers (one for role `verwaltung`) and three packs, built from a fixture. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TemplateFile } from '@ueberblick/core';
import { SESSION_COOKIES } from '../../auth/params';
import type { Principal } from '../../auth/contract';
import { openProjectDb } from '../../db/open';
import { deployProject } from '../../deploy/deploy-project';
import { deployedVersion, loadData } from '../../deploy/versions';
import { createPackBuilder } from '../../packs/builder';
import { fixtureArchive, must, packFile, serve } from '../../packs/testkit';
import { createPackHandlers } from './handlers';

export const NOW = '2026-10-02T10:00:00.000Z';
export const ROLES: Record<string, string[]> = { kontrolle: ['kontrolle'], verwaltung: ['verwaltung'] };
const BOUNDS: [number, number, number, number] = [7.08, 50.7, 7.14, 50.75];

/** Layers `basis` (everyone) and `flur` (`verwaltung`); packs `innen` (both), `intern` (`verwaltung` only), `kontrolle`. */
export function projectFile(bounds = BOUNDS): TemplateFile {
  const file = packFile({ innen: { bounds, min_zoom: 2, max_zoom: 6 } }, (f) => {
    const map = must(f.map);
    map.layers['flur'] = {
      ...must(map.layers['basis']),
      label: { de: 'Flur' },
      kind: 'overlay',
      roles: ['verwaltung'],
    };
    const innen = must(map.packs?.['innen']);
    innen.layers = ['basis', 'flur'];
    must(map.packs)['intern'] = {
      ...innen,
      label: { de: 'Intern', en: 'Internal' },
      layers: ['basis'],
      roles: ['verwaltung'],
    };
    must(map.packs)['kontrolle'] = {
      ...innen,
      label: { de: 'Kontrolle' },
      layers: ['flur'],
      roles: ['kontrolle'],
    };
  });
  return file;
}

export async function packWorld(opts: { build?: boolean; file?: TemplateFile } = {}) {
  const archive = await fixtureArchive(5);
  const db = openProjectDb(':memory:', 'demo');
  const deploy = (file: TemplateFile) =>
    deployProject(db, file, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
  deploy(opts.file ?? projectFile());
  const current = () => must(loadData(db, must(deployedVersion(db)).version));
  const dir = mkdtempSync(join(tmpdir(), 'pk-'));
  const builder = createPackBuilder({
    db,
    dir,
    clock: { now: () => NOW },
    file: () => current().file,
    fetchRange: serve(archive).fetchRange,
    pinned: () => new Set(),
  });
  if (opts.build !== false) await builder.drain();
  const handlers = createPackHandlers({
    auth: {
      authenticate: (id: string | null) =>
        id === null || !(id in ROLES)
          ? null
          : ({ kind: 'participant', id, projectId: 'p1' } as unknown as Principal),
      toActor: (p: { id: string }) => ({ id: p.id, kind: 'participant', roles: ROLES[p.id] ?? [] }),
      rolesFor: () => [],
    } as never,
    project: (key) => (key === 'demo' ? { id: 'p1', key } : undefined),
    projectDb: () => db,
    deployed: () => ({ version: must(deployedVersion(db)).version, config: current() as never }),
    dir: () => dir,
  });
  const request = (path: string, as: string | null, headers: Record<string, string> = {}) =>
    new Request(`http://x/api/p/demo/packs${path}`, {
      headers: {
        ...(as === null
          ? {}
          : {
              cookie: Object.values(SESSION_COOKIES)
                .map((name) => `${name}=${as}`)
                .join('; '),
            }),
        ...headers,
      },
    });
  return { db, dir, builder, handlers, deploy, request, archive };
}
