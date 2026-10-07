/**
 * `GET /api/p/<project>/packs` and `GET /api/p/<project>/packs/<hash>/<layer>.pmtiles` (A-032 items 3 and 4, WP-351).
 *
 * - manifest: 200 JSON with `Cache-Control: private, no-cache` and an ETag over the body (304 on a match). It lists
 *   the `ready` packs of the deployed config the caller's roles see, with the layers they see.
 * - download: participant auth, the same audience (`packsForRoles`), and only `ready` files of a hash the deployed or
 *   a pinned version references. What the caller may not see, or that does not exist, is 404 (never 403). One `Range`
 *   is served as 206, an unsatisfiable one as 416, several as the whole file. The file streams from disk.
 */
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { packsForRoles } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { pinnedFiles } from '../../packs/pinned';
import { layerFile } from '../../packs/build';
import { packTargets, rowsOf } from '../../packs/store';
import type { DeployedConfig } from '../../sync';
import { authorizeProject, DEVICE_KINDS } from '../shared/access';
import type { Handler, ProjectAccessDeps } from '../shared/contract';
import { errorResponse } from '../shared/errors';
import { parseByteRange } from '../shared/range';
import { buildManifest } from './manifest';

export interface PackHandlersDeps extends ProjectAccessDeps {
  projectDb(key: string): Db;
  deployed(key: string): DeployedConfig | undefined;
  /** `<blobs>/packs/<project>`: where the build job writes (`dir` of `createPackBuilder`). */
  dir(key: string): string;
}

export interface PackHandlers {
  readonly manifest: Handler<{ readonly project: string }>;
  readonly download: Handler<{ readonly project: string; readonly hash: string; readonly file: string }>;
}

const HASH = /^[0-9a-f]{64}$/;
const FILE = /^([a-z0-9_]+)\.pmtiles$/;
const notFound = (): Response => errorResponse('not_found', 'No such offline pack file.');

/** True when an `If-None-Match` value names `etag` (a list, weak validators and `*` included). */
const matches = (header: string | null, etag: string): boolean =>
  header !== null &&
  (header.trim() === '*' || header.split(',').some((t) => t.trim().replace(/^W\//, '') === etag));

export function createPackHandlers(deps: PackHandlersDeps): PackHandlers {
  const manifest: PackHandlers['manifest'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const key = caller.project.key;
    const body = JSON.stringify(
      buildManifest(
        deps.projectDb(key),
        key,
        deps.deployed(key),
        caller.actor.roles,
        req.headers.get('accept-language'),
      ),
    );
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
    const headers = {
      'cache-control': 'private, no-cache',
      etag,
      vary: 'Cookie, Accept-Language',
    };
    if (matches(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
    return new Response(body, {
      status: 200,
      headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    });
  };

  const download: PackHandlers['download'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const key = caller.project.key;
    const { hash } = ctx.params;
    const layer = FILE.exec(ctx.params.file)?.[1];
    if (layer === undefined || !HASH.test(hash)) return notFound();
    const db = deps.projectDb(key);
    // The deployed config and every pinned version: a hash outside them is not served (it is garbage).
    const current = deps.deployed(key)?.config.file;
    const files = [...(current === undefined ? [] : [current]), ...pinnedFiles(db)];
    const visible = files.some(
      (f) =>
        f.map !== undefined &&
        packTargets(f).some(
          (t) =>
            t.hash === hash &&
            packsForRoles(f.map ?? { layers: {} }, caller.actor.roles).some(
              (a) => a.key === t.key && a.layers.includes(layer),
            ),
        ),
    );
    const row = visible
      ? rowsOf(db, [hash]).find((r) => r.layer === layer && r.state === 'ready')
      : undefined;
    if (row === undefined || row.sha256 === null) return notFound();
    const path = layerFile(deps.dir(key), hash, layer);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return notFound();
    }
    const etag = `"${row.sha256}"`;
    const headers: Record<string, string> = {
      etag,
      'cache-control': 'private, immutable',
      'accept-ranges': 'bytes',
    };
    if (matches(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
    // `If-Range` with another validator: the file changed, so the whole of it answers.
    const ifRange = req.headers.get('if-range');
    const range = parseByteRange(
      ifRange !== null && ifRange !== etag ? null : req.headers.get('range'),
      size,
    );
    headers['content-type'] = 'application/octet-stream';
    if (range.kind === 'unsatisfiable')
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    const [start, end] = range.kind === 'partial' ? [range.start, range.end] : [0, size - 1];
    headers['content-length'] = String(size === 0 ? 0 : end - start + 1);
    if (range.kind === 'partial') headers['content-range'] = `bytes ${start}-${end}/${size}`;
    if (size === 0) return new Response(null, { status: 200, headers });
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: range.kind === 'partial' ? 206 : 200, headers });
  };

  return { manifest, download };
}
