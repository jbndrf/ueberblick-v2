import { packHandlersFor } from '@ueberblick/server';
import { runtime } from '../runtime';
import type { Call } from './http';

/** `GET /api/p/<project>/packs` and `GET …/packs/<hash>/<layer>.pmtiles` (A-032 items 3 and 4): the device's offline packs. */
export const packManifestRoute = (call: Call): Promise<Response> =>
  packHandlersFor(runtime()).manifest(call.request, { params: { project: call.params['project'] ?? '' } });

export const packDownloadRoute = (call: Call): Promise<Response> =>
  packHandlersFor(runtime()).download(call.request, {
    params: {
      project: call.params['project'] ?? '',
      hash: call.params['hash'] ?? '',
      file: call.params['file'] ?? '',
    },
  });
