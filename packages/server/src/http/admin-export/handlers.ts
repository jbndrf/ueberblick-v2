/**
 * The export endpoints behind the Projekte page's ⋮ menu (WP-384, S3-8). Admin of the project only.
 *
 *   GET /api/admin/p/<project>/export/zip   -> the project ZIP (project file, features, blobs), streamed
 *   GET /api/admin/p/<project>/export/csv   -> `?type=<t>` one CSV; none: a ZIP with one CSV per Objektart (v3's item)
 *   GET /api/admin/p/<project>/export/gpkg  -> the GeoPackage, one layer per Objektart (`?type=<t>` for one)
 *
 * The ZIP is a backup: every feature in every lifecycle state, as folded. CSV follows the data page (`lifecycle=`
 * as there, `deleted` hidden by default). GeoPackage is what the admin may see: rows through `SyncService.visible`,
 * columns through `Perms.readable` (WP-111), as an actor holding every role of the config. Errors use the envelope of
 * `http/shared`; a project without a deployed config answers `conflict` for CSV and GeoPackage.
 */
import { Readable } from 'node:stream';
import { stringify } from 'yaml';
import type { Actor, Key } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { BlobService } from '../../blobs/blobs';
import type { Db } from '../../db/driver';
import { exportArchive } from '../../io/archive/export-zip';
import type { RosterSource } from '../../io/archive/roster';
import { archiveFilename, fileSlug } from '../../io/archive/manifest';
import { zipStream, type ZipEntry } from '../../io/archive/zip';
import { exportGpkg } from '../../io/export';
import type { DeployedConfig, SyncService } from '../../sync';
import { errorResponse } from '../shared/errors';
import type { EffectiveResult } from '../admin-projects';
import { csvOfType } from './csv';

export interface AdminExportCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface AdminExportDeps {
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  db(projectKey: string): Db;
  deployed(projectKey: string): DeployedConfig | undefined;
  /** The project's name and description (control.db). */
  project(projectKey: string): { readonly name: string; readonly description: string } | undefined;
  /** The effective file: the deployed version, else the working draft. */
  effectiveFile(projectKey: string): EffectiveResult;
  visible(projectKey: string): SyncService['visible'];
  blobs(projectKey: string): Pick<BlobService, 'get'>;
  /** The roster source of a project: given, the project ZIP carries the participants with their login tokens (A-046). */
  roster?(projectKey: string): RosterSource;
  readonly now: () => string;
}

export interface AdminExportHandlers {
  zip(call: AdminExportCall): Response;
  csv(call: AdminExportCall): Response;
  gpkg(call: AdminExportCall): Response;
}

const attachment = (body: AsyncIterable<Uint8Array>, type: string, filename: string): Response =>
  new Response(Readable.toWeb(Readable.from(body)) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });

const slug = fileSlug;

export function createAdminExportHandlers(deps: AdminExportDeps): AdminExportHandlers {
  const NOT_DEPLOYED = 'The project has no deployed config yet.';
  return {
    zip(call) {
      const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const key = auth.projectKey;
      const meta = deps.project(key);
      if (meta === undefined) return errorResponse('not_found', `Unknown project ${key}.`);
      const effective = deps.effectiveFile(key);
      if (!effective.ok) return errorResponse('conflict', 'The project file cannot be exported.');
      const body = exportArchive({
        db: deps.db(key),
        project: { key, ...meta },
        fileText: stringify(effective.file),
        deployed: deps.deployed(key) !== undefined,
        blobs: deps.blobs(key),
        ...(deps.roster ? { roster: deps.roster(key) } : {}),
        now: deps.now,
      });
      return attachment(body, 'application/zip', archiveFilename(meta.name));
    },

    csv(call) {
      const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const key = auth.projectKey;
      const deployed = deps.deployed(key);
      if (deployed === undefined) return errorResponse('conflict', NOT_DEPLOYED);
      const params = new URL(call.request.url).searchParams;
      const types = deployed.config.file.types ?? {};
      const one = params.get('type');
      const wanted = one === null ? Object.keys(types) : [one];
      const db = deps.db(key);
      const lifecycle = params.get('lifecycle');
      const made = wanted.map((t) => {
        const def = types[t];
        return def === undefined ? undefined : ([t, csvOfType(db, t, def, lifecycle)] as const);
      });
      if (made.some((m) => m === undefined))
        return errorResponse('not_found', `The project has no feature type '${one ?? ''}'.`);
      for (const m of made)
        if (m !== undefined && !m[1].ok) return errorResponse('invalid_query', m[1].message);
      const name = deps.project(key)?.name ?? key;
      const streams = made.flatMap((m) => (m !== undefined && m[1].ok ? [[m[0], m[1].chunks] as const] : []));
      if (one !== null && streams[0] !== undefined) {
        const chunks = streams[0][1];
        return attachment(
          (async function* () {
            for await (const c of chunks()) yield Buffer.from(c, 'utf8');
          })(),
          'text/csv; charset=utf-8',
          `${slug(name)}-${slug(one)}.csv`,
        );
      }
      const entries: ZipEntry[] = streams.map(([t, chunks]) => ({
        name: `${t}.csv`,
        data: (async function* () {
          for await (const c of chunks()) yield Buffer.from(c, 'utf8');
        })(),
      }));
      return attachment(zipStream(entries), 'application/zip', `${slug(name)}-data.zip`);
    },

    gpkg(call) {
      const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
      if (auth instanceof Response) return auth;
      const key = auth.projectKey;
      const deployed = deps.deployed(key);
      if (deployed === undefined) return errorResponse('conflict', NOT_DEPLOYED);
      const types = Object.keys(deployed.config.file.types ?? {});
      const one = new URL(call.request.url).searchParams.get('type');
      if (one !== null && !types.includes(one))
        return errorResponse('not_found', `The project has no feature type '${one}'.`);
      const actor: Actor = {
        id: call.principal?.id ?? 'admin',
        kind: 'admin',
        roles: Object.keys(deployed.config.file.roles ?? {}) as Key[],
      };
      const name = deps.project(key)?.name ?? key;
      const body = exportGpkg(
        { db: deps.db(key), config: deployed.config, actor, visible: deps.visible(key), now: deps.now },
        (one === null ? types : [one]) as Key[],
      );
      return attachment(
        body,
        'application/geopackage+sqlite3',
        `${slug(name)}${one === null ? '' : `-${slug(one)}`}.gpkg`,
      );
    },
  };
}
