import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { createInProcessTransport } from '../cluster/client';
import type { ClusterTransport, ToWorker } from '../cluster/protocol';
import { pointFeature, testSource } from '../test-helpers';
import { fakeMaplibre } from './renderer-fixture';
import { createMaplibreRenderer } from './renderer';

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => pointFeature(`f${i}`, 5 + (i % 100) / 10, 47 + i / 5000));
const view = {} as never;

function setup(n: number) {
  const { api, calls } = fakeMaplibre();
  const posted: ToWorker[] = [];
  let yields = 0;
  const transport = (): ClusterTransport => {
    const inner = createInProcessTransport();
    return {
      ...inner,
      post: (m) => {
        posted.push(m);
        inner.post(m);
      },
    };
  };
  const source = testSource(many(n));
  const handle = createMaplibreRenderer({
    load: () => Promise.resolve(api),
    transport,
    chunkSize: 1000,
    yieldToMain: () => {
      yields++;
      return Promise.resolve();
    },
  }).mount({} as HTMLElement, view, source);
  return { handle, calls, posted, source, yields: () => yields };
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const applies = (posted: readonly ToWorker[]) => posted.filter((m) => m.type === 'apply');

describe('maplibre-2d renderer: chunked initial delivery', () => {
  it('sends the initial add in chunks with a yield between each', async () => {
    const { handle, posted, yields } = setup(4500);
    await handle.ready;
    await settle();
    const adds = applies(posted).map((m) => (m.type === 'apply' ? m.add.length : 0));
    expect(adds).toEqual([1000, 1000, 1000, 1000, 500]);
    expect(yields()).toBe(4);
  });

  it('asks for clusters after the first chunk and at the end only, and ends complete', async () => {
    const { handle, posted, calls } = setup(4500);
    await handle.ready;
    await settle();
    expect(posted.filter((m) => m.type === 'query').length).toBeLessThanOrEqual(2);
    const items = calls.setData.at(-1)?.features ?? [];
    const total = items.reduce(
      (n, i) => n + (typeof i.properties.count === 'number' ? i.properties.count : 1),
      0,
    );
    expect(total).toBe(4500);
  });

  it('a change arriving mid-load is applied after the chunks before it', async () => {
    const { handle, posted, source } = setup(3000);
    await handle.ready;
    source.emit({ remove: ['f0' as FeatureId] });
    await settle();
    const all = applies(posted);
    expect(all.at(-1)).toMatchObject({ add: [], update: [], remove: ['f0'] });
    expect(all).toHaveLength(4);
  });

  it('destroy stops the delivery', async () => {
    const { handle, posted } = setup(4500);
    await handle.ready;
    handle.destroy();
    await settle();
    expect(applies(posted).length).toBeLessThan(5);
  });

  it('a small change is applied synchronously', async () => {
    const { handle, posted, source } = setup(10);
    await handle.ready;
    const n = posted.length;
    source.emit({ update: [pointFeature('f1', 1, 1)] });
    expect(posted.length).toBe(n + 1);
  });
});
