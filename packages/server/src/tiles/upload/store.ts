/**
 * Where uploaded tile archives live (A-044): `<dataDir>/blobs/tiles/<project>/<id>.pmtiles`, and the open uploads in
 * `<dataDir>/blobs/tiles/<project>/.uploads/<id>/` (`data` = the bytes so far, `job.json` = the job). A local-disk store
 * behind this one module is the seam for an object store or an external tile server later (H6).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Bounds,
  TileUploadFormat,
  TileUploadKind,
  TileUploadRefusal,
  TileUploadState,
} from '@ueberblick/core';

export const ARCHIVE_ID = /^[a-f0-9]{16}$/;

export interface JobResult {
  /** The instance-local URL a `map.layers` entry of source type `pmtiles` uses. */
  readonly url: string;
  readonly archive: string;
  readonly format: TileUploadFormat;
  readonly bounds: Bounds;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly tiles: number;
  readonly bytes: number;
}

/** One upload and its conversion, as stored in `job.json` and returned by the status endpoint. */
export interface UploadJob {
  readonly id: string;
  readonly kind: TileUploadKind;
  readonly name: string;
  /** The format the admin chose; absent: taken from the file. */
  readonly format?: TileUploadFormat;
  /** Declared size in bytes. */
  readonly size: number;
  readonly received: number;
  readonly state: TileUploadState;
  readonly progress: { readonly done: number; readonly total: number };
  readonly result?: JobResult;
  readonly error?: { readonly reason: TileUploadRefusal; readonly message: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TileUploadStore {
  uploadDir(project: string, id: string): string;
  dataPath(project: string, id: string): string;
  archivePath(project: string, id: string): string;
  hasArchive(project: string, id: string): boolean;
  readJob(project: string, id: string): UploadJob | undefined;
  writeJob(project: string, job: UploadJob): void;
  jobs(project: string): UploadJob[];
  /** Deletes the bytes of an upload (the job record stays so the status can still be polled). */
  dropData(project: string, id: string): void;
  /** Moves a finished file into place as the archive. */
  adopt(project: string, id: string, from: string): void;
  /** Deletes the archive file and the job of an id. */
  removeAll(project: string, id: string): void;
}

export function createDiskStore(dataDir: (project: string) => string): TileUploadStore {
  const upload = (project: string, id: string): string => join(dataDir(project), '.uploads', id);
  const archive = (project: string, id: string): string => join(dataDir(project), `${id}.pmtiles`);
  const jobFile = (project: string, id: string): string => join(upload(project, id), 'job.json');
  return {
    uploadDir: (project, id) => {
      mkdirSync(upload(project, id), { recursive: true });
      return upload(project, id);
    },
    dataPath: (project, id) => join(upload(project, id), 'data'),
    archivePath: archive,
    hasArchive: (project, id) => existsSync(archive(project, id)),
    readJob(project, id) {
      try {
        return JSON.parse(readFileSync(jobFile(project, id), 'utf8')) as UploadJob;
      } catch {
        return undefined;
      }
    },
    writeJob(project, job) {
      mkdirSync(upload(project, job.id), { recursive: true });
      const tmp = `${jobFile(project, job.id)}.tmp`;
      writeFileSync(tmp, JSON.stringify(job));
      renameSync(tmp, jobFile(project, job.id));
    },
    jobs(project) {
      const root = join(dataDir(project), '.uploads');
      if (!existsSync(root)) return [];
      return readdirSync(root)
        .filter((id) => ARCHIVE_ID.test(id))
        .flatMap((id) => {
          try {
            return [JSON.parse(readFileSync(jobFile(project, id), 'utf8')) as UploadJob];
          } catch {
            return [];
          }
        });
    },
    dropData(project, id) {
      for (const f of ['data', 'spool', 'out.tmp']) rmSync(join(upload(project, id), f), { force: true });
    },
    adopt(project, id, from) {
      mkdirSync(dataDir(project), { recursive: true });
      renameSync(from, archive(project, id));
    },
    removeAll(project, id) {
      rmSync(archive(project, id), { force: true });
      rmSync(upload(project, id), { recursive: true, force: true });
    },
  };
}
