import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { KeySchema, RESERVED_PROJECT_KEYS } from '@ueberblick/core';
import { CONTROL_MIGRATIONS } from './control-schema';
import { openSqlite, type Db } from './driver';
import { migrate } from './migrate';
import { PROJECT_MIGRATIONS } from './project-schema';

/** A project key that is reserved (`RESERVED_PROJECT_KEYS`). */
export class ReservedProjectKey extends Error {
  constructor(readonly key: string) {
    super(`reserved project key: ${JSON.stringify(key)}`);
    this.name = 'ReservedProjectKey';
  }
}

/**
 * `__` is reserved: a preview is served as `<key>__vorschau` (A-031), so a project key never contains it. The keys of
 * `RESERVED_PROJECT_KEYS` are refused too (`ReservedProjectKey`): their directories are shared by all projects.
 */
export function assertProjectKey(key: string): void {
  if ((RESERVED_PROJECT_KEYS as readonly string[]).includes(key)) throw new ReservedProjectKey(key);
  if (!KeySchema.safeParse(key).success || key.includes('__'))
    throw new Error(`invalid project key: ${JSON.stringify(key)}`);
}

/** Path of one project's database inside the data directory: all project files live in `dir`. */
export function projectDbPath(dir: string, key: string): string {
  assertProjectKey(key);
  return join(dir, `project-${key}.db`);
}

/** Opens (creating and migrating) control.db. Pass `:memory:` for tests. */
export function openControlDb(path: string): Db {
  const db = openSqlite(path);
  migrate(db, CONTROL_MIGRATIONS);
  return db;
}

/** Opens (creating and migrating) the project database file at `path` (a real project's or a preview's). */
export function openProjectDbFile(path: string): Db {
  const db = openSqlite(path);
  migrate(db, PROJECT_MIGRATIONS);
  return db;
}

/** Opens (creating and migrating) `<dir>/project-<key>.db`. `dir` may be `:memory:` for tests. */
export function openProjectDb(dir: string, key: string): Db {
  assertProjectKey(key);
  let path = ':memory:';
  if (dir !== ':memory:') {
    mkdirSync(dir, { recursive: true });
    path = projectDbPath(dir, key);
  }
  const db = openSqlite(path);
  migrate(db, PROJECT_MIGRATIONS);
  return db;
}
