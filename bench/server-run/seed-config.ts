import { goldenAssets } from '../../packages/core/src/testing/golden';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { compile, serialize, TemplateFileSchema, type CompiledConfig } from '../../packages/core/src';
import { fileBlobStore } from '../../packages/server/src/blobs';
import type { Db } from '../../packages/server/src/db/driver';
import type { ProjectStoresDeps } from '../../packages/server/src/http/shared';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';

/**
 * The generator stores an empty `compiled` for its config row. Store the real compiled form of the golden template
 * there (core's `serialize`, what deploy writes) so the production config cache (`configCacheFor`) serves it.
 */
export function seedCompiledConfig(db: Db, version = 1): CompiledConfig {
  const parsed = TemplateFileSchema.parse(
    parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
  );
  const compiled = compile(parsed, { assets: goldenAssets });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
  db.prepare('UPDATE config_versions SET compiled = ? WHERE version = ?').run(
    JSON.stringify(serialize(compiled.config)),
    version,
  );
  return compiled.config;
}

/**
 * `ProjectStoresDeps.blobs` the way the runtime wires it (`fileBlobStore` under a temp dir), with an `onError`
 * that throws so a failed byte delete or sweep fails the bench instead of hiding.
 */
export function benchBlobs(): ProjectStoresDeps['blobs'] {
  return {
    store: () => fileBlobStore(mkdtempSync(join(tmpdir(), 'ub-bench-blobs-'))),
    onError: (key, error) => {
      throw new Error(`bench blobs of ${key}: ${String(error)}`);
    },
  };
}
