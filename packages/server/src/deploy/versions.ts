import {
  COMPILED_FORMAT,
  compile,
  NO_ASSETS,
  hydrate,
  type CompiledConfig,
  type CompiledConfigData,
  type ConfigVersionStatus,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { VersionInfo } from './contract';
import { assertNoOldRules } from './old-format';

interface Row {
  version: number;
  status: ConfigVersionStatus;
  hash: string;
  template: string | null;
  template_version: string | null;
  created_by: string | null;
  created_at: string;
}

const COLUMNS = 'version, status, hash, template, template_version, created_by, created_at';

const info = (r: Row): VersionInfo => ({
  version: r.version,
  status: r.status,
  hash: r.hash,
  template: r.template,
  templateVersion: r.template_version,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

/** All stored versions, oldest first. */
export function versions(db: Db): VersionInfo[] {
  return db.prepare<Row>(`SELECT ${COLUMNS} FROM config_versions ORDER BY version`).all().map(info);
}

export function versionByHash(db: Db, hash: string): VersionInfo | undefined {
  const r = db.prepare<Row>(`SELECT ${COLUMNS} FROM config_versions WHERE hash = ?`).get(hash);
  return r && info(r);
}

export function deployedVersion(db: Db): VersionInfo | undefined {
  const r = db.prepare<Row>(`SELECT ${COLUMNS} FROM config_versions WHERE status = 'deployed'`).get();
  return r && info(r);
}

/** The stored compiled data of a version (`undefined` when there is none). */
export function loadData(db: Db, version: number): CompiledConfigData | undefined {
  const r = db
    .prepare<{ compiled: string }>('SELECT compiled FROM config_versions WHERE version = ?')
    .get(version);
  return r && (JSON.parse(r.compiled) as CompiledConfigData);
}

/**
 * The runtime form of a version: the deployed one by default, any stored one by number (queued runs
 * carry the number they were made against). A stored form older than the running core is a cache
 * and is recompiled from the stored effective file (A-005).
 */
export function loadConfig(db: Db, version?: number): CompiledConfig | undefined {
  const n = version ?? deployedVersion(db)?.version;
  if (n === undefined) return undefined;
  const data = loadData(db, n);
  if (data === undefined) return undefined;
  if (data.format === COMPILED_FORMAT) return hydrate(data);
  assertNoOldRules(db, n, data.file);
  const r = compile(data.file, { assets: NO_ASSETS });
  if (!r.ok) throw new Error(`stored version ${n} no longer compiles: ${r.problems[0]?.path}`);
  return r.config;
}
