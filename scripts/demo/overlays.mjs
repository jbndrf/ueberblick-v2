// The overlay each demo project is deployed with: the golden project file, its `$ref` layer styles embedded. The
// golden files are written for the corpus tooling; the demo adds nothing on top, so it deploys them as they are.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { embedRefs } from '../embed-refs.mjs';

/** The golden project file of `fixture`, with its `$ref` layer styles embedded at the demo's ingestion point. */
export function demoOverlay(root, fixture) {
  return embedRefs(
    parse(readFileSync(join(root, 'fixtures/golden/projects', `${fixture}.yaml`), 'utf8')),
    root,
  );
}
