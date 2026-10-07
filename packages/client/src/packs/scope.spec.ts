// WP-773: offline packs are stored per project and participant, so another project or person on the same browser
// never sees, keeps or deletes them.
import { describe, expect, it } from 'vitest';
import { dirHandle, newTree } from './fake-opfs.testing';
import { bytesOf, fakePack, fakeServer } from './fake-server.testing';
import { createPackManager } from './manager';
import { clearPackScope, deviceOpfsStorage } from './storage-opfs';

const A = bytesOf(500, 1);
const B = bytesOf(300, 2);
const url = (hash: string, layer: string): string => `/api/p/demo/packs/${hash}/${layer}.pmtiles`;

function device() {
  const tree = newTree();
  const nav = { storage: { getDirectory: async () => dirHandle(tree) } };
  const server = (key: string, hash: string, layer: string, bytes: Uint8Array) =>
    fakeServer([fakePack(key, hash, [{ layer, bytes }])], { [url(hash, layer)]: bytes });
  const open = (project: string, participant: string, transport: ReturnType<typeof server>) =>
    createPackManager({ storage: deviceOpfsStorage(nav, { project, participant }), transport });
  return { tree, nav, server, open };
}

describe('pack storage scope (WP-773)', () => {
  it('packs of project A survive opening project B on the same browser', async () => {
    const d = device();
    const a = d.open('pa', 'u1', d.server('innen', 'h1', 'osm', A));
    await a.sync();
    expect(a.hasLayer('osm')).toBe(true);
    const b = d.open('pb', 'u1', d.server('aussen', 'h2', 'flur', B));
    await b.sync();
    expect(b.hasLayer('flur')).toBe(true);
    const again = d.open('pa', 'u1', d.server('innen', 'h1', 'osm', A));
    await again.load();
    expect(again.hasLayer('osm')).toBe(true);
    expect((await again.counts()).totals.packs).toBe(1);
  });

  it('person B cannot read the packs of person A', async () => {
    const d = device();
    await d.open('pa', 'u1', d.server('innen', 'h1', 'osm', A)).sync();
    const other = d.open('pa', 'u2', d.server('innen', 'h1', 'osm', A));
    await other.load();
    expect(other.hasLayer('osm')).toBe(false);
    expect(await other.files.layerFiles('osm')).toEqual([]);
  });

  it('the cleanup only touches the current project and participant directory', async () => {
    const d = device();
    await d.open('pa', 'u1', d.server('innen', 'h1', 'osm', A)).sync();
    const st = deviceOpfsStorage(d.nav, { project: 'pa', participant: 'u1' });
    const before = await st.list();
    expect(before.length).toBeGreaterThan(0);
    // project B syncs a manifest that lists nothing of A, and an empty manifest too
    const b = d.open('pb', 'u1', d.server('aussen', 'h2', 'flur', B));
    await b.sync();
    await d.open('pb', 'u1', fakeServer([], {})).sync();
    expect(await st.list()).toEqual(before);
  });

  it('clear() removes this participant directory only', async () => {
    const d = device();
    await d.open('pa', 'u1', d.server('innen', 'h1', 'osm', A)).sync();
    await d.open('pa', 'u2', d.server('innen', 'h1', 'osm', A)).sync();
    await clearPackScope(d.nav, { project: 'pa', participant: 'u1' });
    expect(await deviceOpfsStorage(d.nav, { project: 'pa', participant: 'u1' }).list()).toEqual([]);
    expect(
      (await deviceOpfsStorage(d.nav, { project: 'pa', participant: 'u2' }).list()).length,
    ).toBeGreaterThan(0);
    await clearPackScope(d.nav, { project: 'pa', participant: 'u1' }); // already empty: no throw
    await clearPackScope({}, { project: 'pa', participant: 'u1' }); // no OPFS: no throw
  });

  it('an id with slashes cannot leave its directory', async () => {
    const d = device();
    await d.open('../x', 'a/b', d.server('innen', 'h1', 'osm', A)).sync();
    expect([...d.tree.dirs.keys()]).toEqual(['packs']);
  });
});
