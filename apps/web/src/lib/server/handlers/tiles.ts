import { createArchiveHandler, tileHandlersFor, tileUploadsFor } from '@ueberblick/server';
import { runtime } from '../runtime';
import type { Call } from './http';

const handlers = () => tileHandlersFor(runtime());

/** `GET /api/p/<project>/tiles/<layer>/<z>/<x>/<y>`: a tile of a map layer through the tile proxy (A-033). */
export const tileRoute = (call: Call): Promise<Response> =>
  handlers().tile(call.request, {
    params: {
      project: call.params['project'] ?? '',
      layer: call.params['layer'] ?? '',
      z: call.params['z'] ?? '',
      x: call.params['x'] ?? '',
      y: call.params['y'] ?? '',
    },
  });

const archive = () => {
  const rt = runtime();
  return createArchiveHandler({
    auth: rt.auth,
    project: (k) => rt.project(k),
    archivePath: (project, id) => tileUploadsFor(rt).archivePath(project, id),
  });
};

/** `GET /api/p/<project>/tiles/archives/<archive>.pmtiles`: an uploaded tile archive, with range requests (A-044). */
export const tileArchiveRoute = (call: Call): Promise<Response> =>
  archive()(call.request, {
    params: { project: call.params['project'] ?? '', archive: call.params['archive'] ?? '' },
  });

/** `GET /api/p/<project>/wms/<layer>?bbox=…&width=…&height=…&crs=…`: a WMS GetMap through the tile proxy. */
export const wmsRoute = (call: Call): Promise<Response> =>
  handlers().wms(call.request, {
    params: { project: call.params['project'] ?? '', layer: call.params['layer'] ?? '' },
  });
