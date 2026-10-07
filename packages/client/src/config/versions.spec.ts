import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { COMPILED_FORMAT, serialize } from '@ueberblick/core/hydrate';
import { TemplateFileSchema, compile } from '@ueberblick/core/schema';
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import type { Run } from '@ueberblick/core/model';
import { openDeviceStore } from '../store/open';
import { fakeEnv, fid, key, memoryMarker, rid } from '../store/test-env';
import type { ConfigFetcher } from './contract';
import { openConfigVersions } from './versions';
import { goldenAssets } from '@ueberblick/core/testing';

const base = import.meta.glob('../../../core/src/schema/compile/__fixtures__/base.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function good(): CompiledConfigData {
  const r = compile(TemplateFileSchema.parse(parse(Object.values(base)[0] as string)), {
    assets: goldenAssets,
  });
  if (!r.ok) throw new Error('base must compile');
  return JSON.parse(JSON.stringify(serialize(r.config))) as CompiledConfigData;
}
const withFormat = (format: number): CompiledConfigData => ({ ...good(), format });

const run = (n: number, configVersion: number): Run => ({
  id: rid(n),
  task: key('kontrolle'),
  actor: { id: 'p1', kind: 'participant', roles: [key('feld')] },
  configVersion,
  featureId: fid(1),
  input: {},
});

function fetcher(answer: (v: number) => Promise<CompiledConfigData>): ConfigFetcher & { calls: number[] } {
  const f = { calls: [] as number[], fetchCompiled: (v: number) => (f.calls.push(v), answer(v)) };
  return f;
}

async function setup() {
  const store = await openDeviceStore('c', { env: fakeEnv(), marker: memoryMarker() });
  return store;
}

describe('ConfigVersions', () => {
  it('hydrates readable stored versions without the network', async () => {
    const store = await setup();
    await store.putConfigVersion(1, good());
    const f = fetcher(() => Promise.reject(new Error('offline')));
    const cv = await openConfigVersions({ store, fetcher: f });
    const c = cv.get(1);
    expect(c).not.toBe('refetching');
    expect(cv.awaiting()).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it.each([
    ['older', COMPILED_FORMAT - 1],
    ['newer', COMPILED_FORMAT + 1],
  ])(
    'a stored version with an %s format is refetched; its queued run stays queued and visible',
    async (_n, format) => {
      const store = await setup();
      await store.putConfigVersion(1, withFormat(format));
      await store.appendRun(run(1, 1));
      let release: (d: CompiledConfigData) => void = () => undefined;
      const f = fetcher(() => new Promise((res) => (release = res)));
      const cv = await openConfigVersions({ store, fetcher: f });
      expect(cv.get(1)).toBe('refetching');
      expect(cv.awaiting()).toEqual([1]);
      expect(f.calls).toEqual([1]); // fetched once, single flight even after another get
      expect(f.calls).toHaveLength(1);
      // meanwhile the run is still there
      const runs = await store.readRuns();
      expect(runs.map((r) => r.run.configVersion)).toEqual([1]);
      const seen: number[] = [];
      cv.subscribe(() => seen.push(1));
      release(good());
      await cv.refresh();
      expect(cv.get(1)).not.toBe('refetching');
      expect(cv.awaiting()).toEqual([]);
      expect(seen.length).toBeGreaterThan(0);
      // the readable copy was persisted for the next start
      const again = await openConfigVersions({
        store,
        fetcher: fetcher(() => Promise.reject(new Error('x'))),
      });
      expect(again.get(1)).not.toBe('refetching');
      expect((await store.readRuns()).length).toBe(1);
    },
  );

  it('an unknown version is wanted and fetched on first get', async () => {
    const store = await setup();
    const f = fetcher(() => Promise.resolve(good()));
    const cv = await openConfigVersions({ store, fetcher: f });
    expect(cv.get(7)).toBe('refetching');
    expect(cv.get(7)).toBe('refetching');
    await cv.refresh();
    expect(f.calls).toEqual([7]);
    expect(cv.get(7)).not.toBe('refetching');
  });

  it('a failed fetch stays refetching with its reason and retries on refresh', async () => {
    const store = await setup();
    let fail = true;
    const f = fetcher(() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(good())));
    const cv = await openConfigVersions({ store, fetcher: f });
    cv.get(2);
    await cv.refresh();
    expect(cv.get(2)).toBe('refetching');
    expect(cv.lastError(2)).toContain('offline');
    fail = false;
    await cv.refresh();
    expect(cv.get(2)).not.toBe('refetching');
    expect(cv.lastError(2)).toBeUndefined();
  });

  it('a fetched copy this core still cannot read is not stored and stays refetching', async () => {
    const store = await setup();
    const f = fetcher(() => Promise.resolve(withFormat(COMPILED_FORMAT + 1)));
    const cv = await openConfigVersions({ store, fetcher: f });
    cv.get(4);
    await cv.refresh();
    expect(cv.get(4)).toBe('refetching');
    expect(cv.lastError(4)).toContain('format');
    expect(await store.readConfigVersions()).toEqual([]);
  });

  it('a stored copy that breaks hydrate for another reason is a bug and propagates', async () => {
    const store = await setup();
    const broken = { ...good(), expressions: [{ path: 'x', source: 'y', ast: null, types: [] }] };
    await store.putConfigVersion(1, broken as unknown as CompiledConfigData);
    await expect(
      openConfigVersions({ store, fetcher: fetcher(() => Promise.resolve(good())) }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('a fetched copy that breaks hydrate as a bug makes refresh() reject and leaves no floating rejection', async () => {
    const store = await setup();
    const broken = {
      ...good(),
      expressions: [{ path: 'x', source: 'y', ast: null, types: [] }],
    } as unknown as CompiledConfigData;
    const cv = await openConfigVersions({ store, fetcher: fetcher(() => Promise.resolve(broken)) });
    expect(cv.get(5)).toBe('refetching'); // background fetch: its failure must not be an unhandled rejection
    await expect(cv.refresh()).rejects.toBeInstanceOf(TypeError);
    expect(cv.get(5)).toBe('refetching');
    expect(await store.readConfigVersions()).toEqual([]);
  });
});
