import { describe, expect, it } from 'vitest';
import { SOURCES, type LayerDef } from './layers';
import { createKeyValues } from './key-values';
import { pointFeature, testSource } from '../test-helpers';
import type { ClusterClient } from '../cluster/client';

const layers = (key: string): LayerDef[] =>
  [
    {
      id: 'l',
      spec: { id: 'l', type: 'circle', source: SOURCES.clusters, paint: { 'circle-color': ['get', key] } },
    },
  ] as unknown as LayerDef[];

function fake() {
  let keys: readonly string[] = [];
  const log: string[] = [];
  const clusters = {
    beginKeys(next: readonly string[]) {
      if (next.length === keys.length && next.every((k) => keys.includes(k))) return undefined;
      const added = next.filter((k) => !keys.includes(k));
      keys = next;
      log.push(`keys:${next.join(',')}`);
      return added;
    },
    addValues(k: readonly string[], fs: readonly { id: string }[]) {
      log.push(`values:${k.join(',')}:${fs.length}`);
    },
  } as unknown as ClusterClient;
  return { clusters, log };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => pointFeature(`t${i}`, 8, 50, { a: i, b: i }));
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe('createKeyValues (WP-848)', () => {
  it('sends the values of a new key in slices; the same keys again send nothing', async () => {
    const { clusters, log } = fake();
    let refreshed = 0;
    const apply = createKeyValues(
      clusters,
      testSource(many(9000)),
      () => Promise.resolve(),
      () => refreshed++,
    );
    apply(layers('a'));
    await settle();
    expect(log).toEqual(['keys:a', 'values:a:4000', 'values:a:4000', 'values:a:1000']);
    expect(refreshed).toBe(2); // when the keys changed, when the values are all sent
    log.length = 0;
    apply(layers('a'));
    await settle();
    expect(log).toEqual([]);
  });

  it('a newer walk ends the older one and takes over the keys still owed', async () => {
    const { clusters, log } = fake();
    const apply = createKeyValues(
      clusters,
      testSource(many(9000)),
      () => Promise.resolve(),
      () => undefined,
    );
    apply(layers('a'));
    apply(layers('b')); // the walk of "a" has sent its first slice only
    await settle();
    const values = log.filter((l) => l.startsWith('values'));
    expect(values.at(-1)).toBe('values:b:1000');
    const lastFull = log.lastIndexOf('values:b:4000');
    expect(lastFull).toBeGreaterThan(-1);
    // "a" is no longer a key, so it is not owed any more
    expect(log.slice(log.indexOf('keys:b')).some((l) => /values:(a|[^:]*,a)[,:]/.test(l))).toBe(false);
  });

  it('cancel ends the walk', async () => {
    const { clusters, log } = fake();
    const apply = createKeyValues(
      clusters,
      testSource(many(9000)),
      () => Promise.resolve(),
      () => undefined,
    );
    apply(layers('a'));
    apply.cancel();
    await settle();
    expect(log.filter((l) => l.startsWith('values'))).toHaveLength(1);
  });
});
