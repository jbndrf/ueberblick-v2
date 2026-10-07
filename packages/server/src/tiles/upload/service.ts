/**
 * The tile upload engine (A-044, WP-405): chunked, resumable uploads of a ZIP, an MBTiles or a PMTiles, converted
 * one at a time (in the process, between yields to other requests) into one PMTiles archive per upload. No HTTP in
 * here: `http/tile-upload` calls it.
 */
import { randomBytes } from 'node:crypto';
import { open, truncate } from 'node:fs/promises';
import { statSync } from 'node:fs';
import {
  TILE_UPLOAD_FORMATS,
  TILE_UPLOAD_KINDS,
  tileUploadMax,
  type TileUploadFormat,
  type TileUploadKind,
} from '@ueberblick/core';
import { emitArchive, type ArchiveResult } from './emit';
import { TileUploadError } from './errors';
import { openMbtiles } from './mbtiles';
import { describePmtiles } from './pmtiles-input';
import { openZipTiles } from './zip-input';
import { ARCHIVE_ID, type TileUploadStore, type UploadJob } from './store';

export interface TileUploadDeps {
  readonly store: TileUploadStore;
  readonly now: () => string;
  /** 16 lowercase hex characters; default random. */
  readonly newId?: () => string;
  /** Called with a failure that was not a typed refusal (a bug or the disk). */
  readonly onError?: (project: string, id: string, error: unknown) => void;
}

export interface StartInput {
  readonly kind: string;
  readonly name: string;
  readonly size: number;
  readonly format?: string | undefined;
}

export interface TileUploads {
  start(project: string, input: StartInput): UploadJob;
  /** Appends the chunk that starts at `offset`; refuses one that does not follow the bytes received so far. */
  chunk(project: string, id: string, offset: number, body: AsyncIterable<Uint8Array>): Promise<UploadJob>;
  finish(project: string, id: string): UploadJob;
  status(project: string, id: string): UploadJob | undefined;
  abort(project: string, id: string): boolean;
  /** The archive file of a finished upload, or undefined. */
  archivePath(project: string, id: string): string | undefined;
  /** Deletes an archive and its job. The caller has checked that nothing references it. */
  removeArchive(project: string, id: string): boolean;
  /** Resolves when no conversion is queued or running (tests, shutdown). */
  idle(): Promise<void>;
}

class Aborted extends Error {}

const clean = (text: string): string => text.replace(/[\u0000-\u001f]/g, ' ').trim();

export function createTileUploads(deps: TileUploadDeps): TileUploads {
  const { store, now } = deps;
  const newId = deps.newId ?? ((): string => randomBytes(8).toString('hex'));
  const flags = new Map<string, { aborted: boolean }>();
  /** Uploads with a chunk being written: a second chunk, finish or abort would corrupt the file. */
  const inFlight = new Set<string>();
  const busy = (): TileUploadError =>
    new TileUploadError('bad_chunk', 'A chunk of this upload is still in flight.');
  let tail: Promise<void> = Promise.resolve();

  const get = (project: string, id: string): UploadJob | undefined =>
    ARCHIVE_ID.test(id) ? store.readJob(project, id) : undefined;
  const save = (project: string, job: UploadJob, patch: Partial<UploadJob>): UploadJob => {
    const next: UploadJob = { ...job, ...patch, updatedAt: now() };
    store.writeJob(project, next);
    return next;
  };

  async function convert(
    project: string,
    job: UploadJob,
    flag: { aborted: boolean },
  ): Promise<ArchiveResult> {
    const input = store.dataPath(project, job.id);
    const chosen = job.format;
    const progress = (done: number, total: number): void => {
      if (flag.aborted) throw new Aborted();
      save(project, store.readJob(project, job.id) ?? job, { progress: { done, total } });
    };
    if (job.kind === 'pmtiles') {
      const info = await describePmtiles(input, chosen);
      store.adopt(project, job.id, input);
      return info;
    }
    const source = job.kind === 'zip' ? await openZipTiles(input, chosen) : await openMbtiles(input, chosen);
    try {
      const out = `${store.uploadDir(project, job.id)}/out.tmp`;
      const info = await emitArchive(source, store.uploadDir(project, job.id), out, progress);
      store.adopt(project, job.id, out);
      return info;
    } finally {
      source.close();
    }
  }

  async function run(project: string, id: string): Promise<void> {
    const flag = flags.get(id) ?? { aborted: false };
    let job = get(project, id);
    if (job === undefined) return;
    if (flag.aborted) {
      flags.delete(id);
      store.removeAll(project, id);
      return;
    }
    job = save(project, job, { state: 'processing', progress: { done: 0, total: 0 } });
    try {
      const info = await convert(project, job, flag);
      store.dropData(project, id);
      save(project, store.readJob(project, id) ?? job, {
        state: 'done',
        progress: { done: info.tiles, total: info.tiles },
        result: {
          url: `/api/p/${project}/tiles/archives/${id}.pmtiles`,
          archive: id,
          format: info.format,
          bounds: info.bounds,
          minZoom: info.minZoom,
          maxZoom: info.maxZoom,
          tiles: info.tiles,
          bytes: info.bytes,
        },
      });
    } catch (e) {
      if (e instanceof Aborted) {
        store.removeAll(project, id);
        return;
      }
      if (!(e instanceof TileUploadError)) deps.onError?.(project, id, e);
      const error =
        e instanceof TileUploadError
          ? { reason: e.reason, message: e.message }
          : { reason: 'corrupt' as const, message: 'The file could not be converted.' };
      store.dropData(project, id);
      save(project, store.readJob(project, id) ?? job, { state: 'failed', error });
    } finally {
      flags.delete(id);
    }
  }

  return {
    start(project, input) {
      if (!TILE_UPLOAD_KINDS.has(input.kind))
        throw new TileUploadError('not_tiles', 'Upload a ZIP, MBTiles or PMTiles file.');
      const kind: TileUploadKind = input.kind;
      if (input.format !== undefined && (!TILE_UPLOAD_FORMATS.has(input.format) || input.format === 'pbf'))
        throw new TileUploadError('wrong_format', 'The tile format is PNG, JPG or WEBP.');
      const format: TileUploadFormat | undefined = input.format as TileUploadFormat | undefined;
      const name = clean(input.name).slice(0, 120);
      if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > tileUploadMax('bytes'))
        throw new TileUploadError('too_large', `An upload may be at most ${tileUploadMax('bytes')} bytes.`);
      if (store.jobs(project).filter((j) => j.state === 'receiving').length >= tileUploadMax('open_uploads'))
        throw new TileUploadError('too_many_uploads', 'Finish or cancel an open upload first.');
      const id = newId();
      store.uploadDir(project, id);
      const stamp = now();
      const job: UploadJob = {
        id,
        kind,
        name: name === '' ? id : name,
        ...(format === undefined ? {} : { format }),
        size: input.size,
        received: 0,
        state: 'receiving',
        progress: { done: 0, total: 0 },
        createdAt: stamp,
        updatedAt: stamp,
      };
      store.writeJob(project, job);
      return job;
    },

    async chunk(project, id, offset, body) {
      const job = get(project, id);
      if (job === undefined) throw new TileUploadError('bad_chunk', 'No such upload.');
      if (job.state !== 'receiving')
        throw new TileUploadError('bad_chunk', 'The upload is no longer receiving bytes.');
      if (offset !== job.received)
        throw new TileUploadError(
          'bad_chunk',
          `The next chunk starts at byte ${job.received}, not ${offset}.`,
        );
      if (inFlight.has(id)) throw busy();
      inFlight.add(id);
      const path = store.dataPath(project, id);
      let written = 0;
      let fh: Awaited<ReturnType<typeof open>> | undefined;
      try {
        fh = await open(path, 'a');
        for await (const piece of body) {
          written += piece.length;
          if (written > tileUploadMax('chunk_bytes') || offset + written > job.size)
            throw new TileUploadError(
              offset + written > job.size ? 'too_large' : 'bad_chunk',
              offset + written > job.size
                ? 'More bytes arrived than were declared.'
                : `A chunk may be at most ${tileUploadMax('chunk_bytes')} bytes.`,
            );
          await fh.write(piece);
        }
        await fh.close();
        fh = undefined;
        return save(project, job, { received: offset + written });
      } catch (e) {
        if (fh !== undefined) {
          await fh.close();
          await truncate(path, offset);
        }
        throw e;
      } finally {
        inFlight.delete(id);
      }
    },

    finish(project, id) {
      if (inFlight.has(id)) throw busy();
      const job = get(project, id);
      if (job === undefined || job.state !== 'receiving')
        throw new TileUploadError('bad_chunk', 'No open upload with this id.');
      const onDisk = (() => {
        try {
          return statSync(store.dataPath(project, id)).size;
        } catch {
          return 0;
        }
      })();
      if (job.received !== job.size || onDisk !== job.size)
        throw new TileUploadError('incomplete', `${job.received} of ${job.size} bytes arrived.`);
      const queued = save(project, job, { state: 'queued' });
      flags.set(id, { aborted: false });
      tail = tail.then(() => run(project, id)).catch(() => undefined);
      return queued;
    },

    status(project, id) {
      const job = get(project, id);
      if (job !== undefined && (job.state === 'processing' || job.state === 'queued') && !flags.has(id)) {
        // The process restarted while this job ran: it will not continue.
        store.dropData(project, id);
        return save(project, job, {
          state: 'failed',
          error: { reason: 'incomplete', message: 'The server restarted during processing. Upload again.' },
        });
      }
      return job;
    },

    abort(project, id) {
      if (inFlight.has(id)) throw busy();
      const job = get(project, id);
      if (job === undefined) return false;
      if (job.state === 'done') return false;
      const flag = flags.get(id);
      if (flag !== undefined) flag.aborted = true;
      else store.removeAll(project, id);
      return true;
    },

    archivePath: (project, id) =>
      ARCHIVE_ID.test(id) && store.hasArchive(project, id) ? store.archivePath(project, id) : undefined,

    removeArchive(project, id) {
      if (!ARCHIVE_ID.test(id) || !store.hasArchive(project, id)) return false;
      store.removeAll(project, id);
      return true;
    },

    idle: () => tail,
  };
}
