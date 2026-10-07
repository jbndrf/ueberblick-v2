import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TemplateFile } from '@ueberblick/core';
import { createBlobs, fileBlobStore } from '../blobs';
import type { Db } from '../db/driver';
import { openProjectDb } from '../db/open';
import { sqliteAccessLog } from './access-log';
import type { AccessLogEntry, ProjectExport } from './contract';

export const NOW = '2026-09-30T10:00:00.000Z';

/** Personal properties of every kind (B-005): actor, property:<key>, feature. */
export const FILE = {
  schema: 'ueberblick/1',
  types: {
    meldung: {
      label: 'Meldung',
      geometry: 'point',
      properties: {
        titel: { type: 'text' },
        lage: { type: 'geometry' },
        melder: {
          type: 'participant',
          label: { de: 'Melder', en: 'Reporter' },
          personal: { subject: 'actor' },
        },
        foto: { type: 'file', personal: { subject: 'actor' } },
        zustaendig: { type: 'participant' },
        kontakt: { type: 'text', personal: { subject: 'property:zustaendig' } },
      },
    },
    person: {
      label: 'Person',
      properties: {
        name: { type: 'text', personal: { subject: 'feature' } },
        notiz: { type: 'text' },
      },
    },
  },
} as unknown as TemplateFile;

export interface World {
  readonly db: Db;
  readonly project: ProjectExport;
  readonly log: AccessLogEntry[];
  put(bytes: Uint8Array, mime: string): Promise<string>;
  participant(id: string, name: string): void;
  run(id: string, actor: string, task?: string, outcome?: string, input?: unknown, result?: unknown): void;
  obs(run: string, feature: string, property: string, value: unknown, time?: string): number;
  feature(id: string, type: string, geometry?: unknown): void;
  dispose(): void;
}

/** A project database with a blob store; `run`/`obs` insert rows directly, as the run store would have. */
export function world(): World {
  const root = mkdtempSync(join(tmpdir(), 'ub-export-'));
  const db = openProjectDb(':memory:', 'demo');
  const blobs = createBlobs({ db, store: fileBlobStore(root), clock: { now: () => NOW } });
  const log: AccessLogEntry[] = [];
  const sink = sqliteAccessLog(db);
  let n = 0;
  return {
    db,
    log,
    project: {
      key: 'demo',
      db,
      blobs,
      config: { file: FILE },
      configVersion: 3,
      clock: { now: () => NOW },
      accessLog: {
        record(e) {
          log.push(e);
          sink.record(e);
        },
      },
    },
    async put(bytes, mime) {
      async function* src(): AsyncGenerator<Uint8Array> {
        yield bytes;
      }
      return (await blobs.put(src(), mime)).sha256;
    },
    participant(id, name) {
      db.prepare('INSERT INTO participants (id, name, roles) VALUES (?, ?, ?)').run(id, name, '["melder"]');
    },
    run(id, actor, task = 'melden', outcome = 'accepted', input = { by: actor }, result = undefined) {
      db.prepare(
        'INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, seq, result) VALUES (?, ?, ?, ?, 3, ?, ?, ?, ?, ?)',
      ).run(
        id,
        actor,
        'participant',
        task,
        JSON.stringify(input),
        NOW,
        outcome,
        ++n,
        result === undefined ? null : JSON.stringify(result),
      );
    },
    obs(run, feature, property, value, time = NOW) {
      const r = db
        .prepare(
          'INSERT INTO observations (run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?)',
        )
        .run(run, feature, property, JSON.stringify(value), time);
      return Number(r.lastInsertRowid);
    },
    feature(id, type, geometry) {
      db.prepare(
        'INSERT INTO features (id, type, config_version, properties, geometry, updated_seq) VALUES (?, ?, 3, ?, ?, 1)',
      ).run(id, type, '{}', geometry === undefined ? null : JSON.stringify(geometry));
    },
    dispose() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
