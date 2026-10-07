import { describe, expect, it } from 'vitest';
import { FakeBlobServer, FakeRunServer } from '../queue/queue.testing';
import { deviceClone } from './clone.testing';

const proxy = () => new Proxy({ type: 'Point', coordinates: [10, 50] }, {});

describe('deviceClone: what a device store does to a value it keeps (IndexedDB structured clone)', () => {
  it('copies plain data, so a later change of the original is not seen in the copy', () => {
    const a = { n: [1, 2], m: new Uint8Array([1, 2]) };
    const b = deviceClone(a);
    a.n.push(3);
    a.m[0] = 9;
    expect(b).toEqual({ n: [1, 2], m: new Uint8Array([1, 2]) });
  });

  it.each([
    ['a Proxy', proxy],
    ['a function', () => () => 1],
    ['an object holding a function', () => ({ f: () => 1 })],
    ['a symbol', () => Symbol('x')],
  ])('throws DataCloneError for %s', (_n, make) => {
    expect(() => deviceClone({ input: make() })).toThrowError(
      expect.objectContaining({ name: 'DataCloneError' }),
    );
  });
});

describe('the fake servers keep copies, like the wire does', () => {
  it('FakeBlobServer stores a copy of the bytes', async () => {
    const s = new FakeBlobServer();
    const bytes = new Uint8Array([1, 2, 3]);
    await s.put('sha', bytes, 'image/jpeg');
    bytes[0] = 9;
    expect([...(s.held.get('sha')?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it('FakeRunServer rejects a payload that cannot be cloned', async () => {
    const s = new FakeRunServer();
    const run = { id: 'r1', input: { g: proxy() } } as never;
    await expect(s.send({ kind: 'run', run, blobs: [] } as never)).rejects.toMatchObject({
      name: 'DataCloneError',
    });
  });
});
