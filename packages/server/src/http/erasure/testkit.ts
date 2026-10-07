/** A runtime in miniature for the project-store erasure specs: a project database with the erasure template deployed. */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlobs, fileBlobStore, type BlobStore } from '../../blobs';
import type { Db } from '../../db/driver';
import { openProjectDb } from '../../db/open';
import { deploy } from '../../deploy';
import { createBlobUploads } from '../../store/blobs/uploads';
import { erasureTemplate, mia } from '../../store/run/erasure.testkit';
import { logSpy } from '../../store/run/log.testkit';
import { createProjectStores, type ProjectStoresDeps } from '../shared';

export const PHOTO = Buffer.from('personal photo');
export const PHOTO_SHA = createHash('sha256').update(PHOTO).digest('hex');
async function* bytes(b: Buffer): AsyncGenerator<Uint8Array> {
  yield b;
}

const dirs: string[] = [];
export function cleanup(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export async function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-erase-http-'));
  dirs.push(dir);
  const blobStore: BlobStore = fileBlobStore(dir);
  const clock = { now: () => '2026-05-01T08:00:00.000Z' };
  const db: Db = openProjectDb(':memory:', 'trees');
  const errors: unknown[] = [];
  const stores: ProjectStoresDeps = {
    clock,
    log: logSpy().log,
    projectDb: () => db,
    blobs: { store: () => blobStore, onError: (_key, e) => void errors.push(e) },
  };
  deploy(db, erasureTemplate(), 'admin', { clock });
  const store = createProjectStores(stores);
  let n = 0;
  const runId = (): string => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
  /** mia reported with the photo stored as a blob; her run is the personal value's only reference. */
  async function seedReport(): Promise<void> {
    await createBlobs({ db, store: blobStore, clock }).put(bytes(PHOTO), 'image/jpeg');
    createBlobUploads(db, clock).record(mia, PHOTO_SHA);
    store('trees').submit({
      id: runId(),
      task: 'melden',
      actor: mia,
      configVersion: 1,
      input: { kategorie: 'strasse', foto: [{ sha256: PHOTO_SHA, name: 'a.jpg', mime: 'image/jpeg' }] },
    } as never);
  }
  /** A run of the `erase_subject` task, as it arrives through the runs endpoint. */
  const erase = (): never =>
    ({
      id: runId(),
      task: 'erase_subject',
      actor: { id: 'root', kind: 'admin', roles: [] },
      configVersion: 1,
      input: { subject: 'mia' },
    }) as never;
  /** The same runtime with another byte store (a failing or dying one). */
  const withBytes = (bytesOf: BlobStore): ProjectStoresDeps => ({
    ...stores,
    blobs: { store: () => bytesOf, onError: (_key, e) => void errors.push(e) },
  });
  return { store, stores, blobStore, db, seedReport, erase, errors, withBytes };
}
