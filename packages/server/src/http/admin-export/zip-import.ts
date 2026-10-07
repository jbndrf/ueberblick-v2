/**
 * "ZIP importieren" over HTTP (WP-384, S3-8; v3 `api/project-imports/upload/*`, init, chunks, finalize, status):
 *
 *   POST /api/admin/projects/import-zip?name=<Name>   body: the ZIP (raw)  -> 202 { job } | 411 | 413 | 400
 *   GET  /api/admin/projects/import-zip/<job>                              -> { job: { state, done, total, key?, problems? } }
 *
 * The body is streamed to a temporary file (never held in memory, capped by `ARCHIVE_LIMITS`), the job then reads the
 * file through `importArchive` and reports progress. The job table lives in this process: a restart loses a running
 * job, and the page then reads an unknown job as failed (the project the job had begun stays, as a refused import's).
 * Any admin may import, as for "Projekt erstellen".
 */
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ImportJobState } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { ArchiveImportResult, ArchiveProblem } from '../../io/archive/import-zip';
import { ARCHIVE_LIMITS } from '../../io/archive/manifest';
import { errorResponse, jsonResponse } from '../shared/errors';

export interface ArchiveImportCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface ArchiveImportJob {
  readonly id: string;
  readonly state: ImportJobState;
  readonly done: number;
  readonly total: number;
  readonly key?: string;
  /** Participants that got new login tokens because theirs were in use (A-046). */
  readonly renewedTokens?: number;
  readonly problems?: readonly ArchiveProblem[];
}

export interface ArchiveImportHttpDeps {
  /** Runs the import of the ZIP at `path` for the admin `by`; reports progress as it goes. */
  run(
    path: string,
    name: string | undefined,
    by: string,
    progress: (done: number, total: number) => void,
  ): Promise<ArchiveImportResult>;
  readonly maxBytes?: number;
  readonly newId: () => string;
  /** Finished jobs kept for the page to read; default 50. */
  readonly keep?: number;
}

export interface ArchiveImportHandlers {
  start(call: ArchiveImportCall): Promise<Response>;
  status(call: ArchiveImportCall): Response;
  /** Resolves when no job is running (tests, shutdown). */
  idle(): Promise<void>;
}

class TooLarge extends Error {}

const limiter = (max: number): Transform => {
  let n = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      n += chunk.byteLength;
      done(n > max ? new TooLarge() : null, chunk);
    },
  });
};

export function createArchiveImportHandlers(deps: ArchiveImportHttpDeps): ArchiveImportHandlers {
  const cap = deps.maxBytes ?? ARCHIVE_LIMITS.maxBytes;
  const keep = deps.keep ?? 50;
  const jobs = new Map<string, ArchiveImportJob>();
  const running = new Set<Promise<void>>();
  const set = (job: ArchiveImportJob): void => {
    jobs.delete(job.id);
    jobs.set(job.id, job);
    for (const id of jobs.keys()) {
      if (jobs.size <= keep) break;
      if (jobs.get(id)?.state === 'done' || jobs.get(id)?.state === 'failed') jobs.delete(id);
    }
  };

  const admin = (principal: Principal | null): Principal | Response =>
    principal === null
      ? jsonResponse({ error: 'Sign in first.' }, 401)
      : principal.kind !== 'admin'
        ? jsonResponse({ error: 'Admin access required.' }, 403)
        : principal;

  return {
    async start(call) {
      const principal = admin(call.principal);
      if (principal instanceof Response) return principal;
      const declared = call.request.headers.get('content-length');
      if (declared !== null && Number(declared) > cap)
        return jsonResponse({ error: 'The file is too large.', problems: [] }, 413);
      if (call.request.body === null)
        return jsonResponse({ error: 'Send the ZIP as the request body.', problems: [] }, 400);
      const dir = mkdtempSync(join(tmpdir(), 'ueberblick-zip-import-'));
      const path = join(dir, 'upload.zip');
      try {
        await pipeline(
          Readable.fromWeb(call.request.body as Parameters<typeof Readable.fromWeb>[0]),
          limiter(cap),
          createWriteStream(path),
        );
      } catch (e) {
        rmSync(dir, { recursive: true, force: true });
        if (e instanceof TooLarge)
          return jsonResponse({ error: 'The file is too large.', problems: [] }, 413);
        return jsonResponse({ error: 'The upload was interrupted.', problems: [] }, 400);
      }
      const typed = new URL(call.request.url).searchParams.get('name')?.trim();
      const id = deps.newId();
      set({ id, state: 'queued', done: 0, total: 0 });
      const job = (async () => {
        try {
          set({ id, state: 'running', done: 0, total: 0 });
          const r = await deps.run(path, typed === '' ? undefined : typed, principal.id, (done, total) =>
            set({ id, state: 'running', done, total }),
          );
          const last = jobs.get(id);
          set(
            r.ok
              ? {
                  id,
                  state: 'done',
                  done: last?.total ?? 0,
                  total: last?.total ?? 0,
                  key: r.key,
                  ...(r.renewedTokens !== undefined ? { renewedTokens: r.renewedTokens } : {}),
                }
              : {
                  id,
                  state: 'failed',
                  done: last?.done ?? 0,
                  total: last?.total ?? 0,
                  problems: r.problems,
                },
          );
        } catch (e) {
          set({
            id,
            state: 'failed',
            done: 0,
            total: 0,
            problems: [{ path: '', message: e instanceof Error ? e.message : 'The import failed.' }],
          });
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      })();
      running.add(job);
      void job.finally(() => running.delete(job));
      return jsonResponse({ job: id }, 202);
    },

    status(call) {
      const principal = admin(call.principal);
      if (principal instanceof Response) return principal;
      const job = jobs.get(call.params['job'] ?? '');
      if (job === undefined) return errorResponse('not_found', 'No such import job.');
      return jsonResponse({ job });
    },

    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}
