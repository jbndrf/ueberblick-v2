// Ingestion for the golden corpus on disk (B-013): a stored project file is self-contained, so the `{ $ref }` layer
// styles of a golden template or overlay are replaced by the bundle file (fixtures/golden/<ref>) before it is
// published or deployed. One walker, core's `embedRefs` (packages/core/src/schema/compile/embed-refs.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embedRefs as embed } from '../packages/core/src/schema/compile/embed-refs.ts';

/**
 * `value` with every `{ $ref: 'styles/x.json' }` object replaced by the JSON of `<root>/fixtures/golden/<ref>`, and every
 * `{ $ref: 'icons/x.svg', size? }` by `{ svg: <the file's text>, size? }` (an icon, WP-674: a text file stays text).
 */
export const embedRefs = (value, root) =>
  embed(value, (ref) => {
    const text = readFileSync(join(root, 'fixtures/golden', ref), 'utf8');
    return ref.endsWith('.svg') ? text : JSON.parse(text);
  });
