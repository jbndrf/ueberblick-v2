// WP-351: the runtime builds offline packs after a deploy, never in parallel, stops with the process and is switched
// off by PACK_BUILD=0. The queue rows of a deploy are written either way (WP-350); only the building is switched.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { deployProject, type FetchRange } from '@ueberblick/server';
import { createRuntime, type Runtime } from '../../../../../lib/server/runtime';

const template = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as Parameters<typeof deployProject>[1];

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world(packBuild: boolean, packFetch: FetchRange) {
  const dir = mkdtempSync(join(tmpdir(), 'ub-packs-'));
  dirs.push(dir);
  const rt = createRuntime({
    dataDir: dir,
    secureCookies: false,
    packBuild,
    packFetch,
    sink: () => undefined,
  });
  runtimes.push(rt);
  rt.control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('p1', 'demo', 'demo', 'x');
  return rt;
}

function deployWithPack(rt: Runtime) {
  const file = structuredClone(template) as Parameters<typeof deployProject>[1] & { map?: unknown };
  file.map = {
    layers: {
      basis: {
        label: { de: 'Basis' },
        kind: 'base',
        source: { type: 'pmtiles', url: 'https://tiles.test/r.pmtiles' },
      },
    },
    packs: {
      innen: {
        label: { de: 'Innen' },
        bounds: [7, 50, 7.1, 50.1],
        min_zoom: 2,
        max_zoom: 5,
        layers: ['basis'],
      },
    },
  };
  return deployProject(rt.projectDb('demo'), file, 'admin', {
    clock: rt.clock,
    afterDeploy: () => rt.services.afterDeploy('demo'),
  });
}

const states = (rt: Runtime): string[] =>
  rt
    .projectDb('demo')
    .prepare<{ state: string }>('SELECT state FROM pack_builds')
    .all()
    .map((r) => r.state);

describe('offline pack builders in the runtime', () => {
  it('a deploy kicks a drain that reads the source; a failure is recorded, not thrown', async () => {
    const calls: string[] = [];
    const rt = world(true, async (url) => {
      calls.push(url);
      throw new Error('offline');
    });
    deployWithPack(rt);
    await rt.packs.idle();
    expect(calls).toEqual(['https://tiles.test/r.pmtiles']);
    expect(states(rt)).toEqual(['failed']);
  });

  it('PACK_BUILD off builds nothing', async () => {
    const calls: string[] = [];
    const rt = world(false, async (url) => {
      calls.push(url);
      return new Uint8Array();
    });
    deployWithPack(rt);
    await rt.packs.idle();
    expect(calls).toEqual([]);
    expect(states(rt)).toEqual(['queued']);
  });

  it('stop() ends the drains: a later deploy builds nothing', async () => {
    const rt = world(true, async () => new Uint8Array());
    rt.stop();
    deployWithPack(rt);
    await rt.packs.idle();
    expect(states(rt)).toEqual(['queued']);
  });
});
