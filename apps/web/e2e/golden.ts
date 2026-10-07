// The golden corpus as an ingestion point stores it (B-013, WP-577): a stored project file is self-contained, so
// the `$ref` layer styles are embedded before a spec publishes or deploys a golden file.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { embedRefs } from '../../../scripts/embed-refs.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let dir: string | undefined;

/** A golden file (path under `fixtures/golden/`) with its `$ref` styles embedded, as plain data. */
export function goldenData(rel: string): unknown {
  return embedRefs(parse(readFileSync(join(ROOT, 'fixtures/golden', rel), 'utf8')), ROOT);
}

/** The same as a file on disk (JSON is YAML) for the CLI's `publish-template`. */
export function goldenFile(rel: string): string {
  dir ??= mkdtempSync(join(tmpdir(), 'ub-golden-'));
  const path = join(dir, rel.replaceAll('/', '_'));
  writeFileSync(path, JSON.stringify(goldenData(rel)));
  return path;
}
