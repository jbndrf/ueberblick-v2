// The dedicated worker of the Safari write path (WP-650): writes the pack files into OPFS with a sync access handle,
// which is the only OPFS write Safari has. Started by `browser.ts` only where the main thread cannot write, with the
// project and person in its name (Vite only bundles a worker whose URL is a plain literal, so the scope cannot ride in the URL) so it writes into the same directory the reader looks in (WP-773).
import { packScopeFromName } from './pack-scope';
import { scopedPackRoot, serveWriter, type SyncDirHandle, type WriterPort } from '@ueberblick/client';

const scope = packScopeFromName(self.name);

serveWriter(
  self as unknown as WriterPort,
  scopedPackRoot(
    async () => (await navigator.storage.getDirectory()) as never,
    scope,
  ) as unknown as () => Promise<SyncDirHandle>,
);
