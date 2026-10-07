// The harness entry: a memory pack store and a fake pack server behind the real tab. `window.__pack` lets the spec hold
// and release the downloads, switch the server off and fire the install prompt. Test fixture only.
import { mount } from 'svelte';
import '../../../../../../app.css';
import { createPackManager } from '../../../../../../../../../packages/client/src/packs/manager';
import { memoryPackStorage } from '../../../../../../../../../packages/client/src/packs/storage-memory';
import { fakeOffline } from '../../../../offline/fake.testing';
import Harness from './Harness.svelte';

const PHOTOS = ['a', 'b', 'c'].map((c) => c.repeat(64));
const fake = fakeOffline({ packs: [{ key: 'innen', label: 'Innenstadt', layer: 'osm' }], photos: PHOTOS });
let release: () => void = () => undefined;
let gate: Promise<void> | undefined;
const real = fake.server.download.bind(fake.server);
fake.server.download = async (url, from, signal) => {
  await gate;
  return real(url, from, signal);
};
/** A pack file of "innen" as another device would have saved it; `corrupt` flips the last byte (a sha256 mismatch). */
async function packFileBytes(corrupt: boolean): Promise<number[]> {
  const other = createPackManager({ storage: memoryPackStorage(), transport: fake.server });
  await other.sync();
  const bytes = new Uint8Array(
    (await (await other.packFile('innen'))?.blob.arrayBuffer()) ?? new ArrayBuffer(0),
  );
  if (corrupt) bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  return [...bytes];
}
(window as unknown as { __pack: unknown }).__pack = {
  file: packFileBytes,
  hold: () => void (gate = new Promise<void>((r) => (release = r))),
  release: () => release(),
  offline: () => void (fake.server.offline = true),
  online: () => void (fake.server.offline = false),
  fire: fake.fire,
  holdThumbs: () => fake.net.hold(),
  releaseThumbs: () => fake.net.release(),
  thumbs: () => fake.thumbs.count(),
  pref: () => fake.pref.on,
};

mount(Harness, { target: document.getElementById('app') as HTMLElement, props: { context: fake.context } });
