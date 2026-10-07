/**
 * The template identity of an archived project file (WP-384). The archive holds the project's effective file, which
 * still names the template it came from (`template: { key, version }`) although overlays have changed it. Creating a
 * project from that file publishes it as a template version, and a version that exists with other content is a
 * conflict. So a file whose `key@version` is unknown here is published as it is, a file identical to the published
 * one is reused, and a file that differs gets its own key derived from its content: the same file imported twice
 * finds the template it published the first time.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';
import { TemplateFileSchema } from '@ueberblick/core';
import type { TemplateSource } from '../../deploy';

export const OWN_TEMPLATE_VERSION = '1.0.0';

/** The project file text with an identity that cannot clash with a published template of the same name. */
export function withOwnIdentity(templates: TemplateSource, text: string): string {
  const file = TemplateFileSchema.parse(parse(text));
  const published = templates.resolve(`${file.template.key}@${file.template.version}`);
  if (published === undefined || isDeepStrictEqual(published, file)) return text;
  const { label, ...rest } = file.template;
  const hash = createHash('sha256').update(JSON.stringify(file)).digest('hex').slice(0, 10);
  const own = { ...rest, key: `import_${hash}`, version: OWN_TEMPLATE_VERSION };
  return stringify({ ...file, template: label === undefined ? own : { ...own, label } });
}
