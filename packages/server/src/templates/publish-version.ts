/**
 * Publishing a template version from its YAML text (docs/08 "Diffs and deploys", docs/03 "Project files"): the same
 * `core.checkPublish` gate the builder's Versions page shows, then the stored template. The one function behind
 * `POST /builder-api/<project>/versions/publish`, `POST /api/admin/templates` and the template-file import (R1).
 */
import {
  checkPublish,
  compareVersions,
  TemplateFileSchema,
  type PublishOutcome,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { parseStoredTemplate } from '../deploy/old-format';
import { parseSourceText } from './source-text';
import { publishTemplate } from './templates';

/** The published templates of one key, for upgrade offers and the publish check. */
export interface TemplateCatalog {
  /** Every published version of `key`, in any order. */
  versionsOf(key: string): readonly TemplateFile[];
}

/** The catalog of `control.db`'s published templates. */
export function controlCatalog(control: Db): TemplateCatalog {
  return {
    versionsOf: (key) =>
      control
        .prepare<{ version: string; source: string }>('SELECT version, source FROM templates WHERE key = ?')
        .all(key)
        .map((r) => parseStoredTemplate(key, r.version, r.source)),
  };
}

const at = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '' : `${path.map(String).join('.')}: `;

/** Publishes a template version (YAML text): the publish check, then the stored template. */
export function publishTemplateVersion(
  control: Db,
  catalog: TemplateCatalog,
  clock: { now(): string },
  source: string,
): PublishOutcome {
  const text = parseSourceText(source, 'The text is not valid YAML.');
  if (!text.ok) return { ok: false, reason: 'invalid', messages: [text.message] };
  const parsed = TemplateFileSchema.safeParse(text.value);
  if (!parsed.success)
    return {
      ok: false,
      reason: 'invalid',
      messages: parsed.error.issues.map((i) => `${at(i.path)}${i.message}`),
    };
  const next = parsed.data;
  const previous = catalog
    .versionsOf(next.template.key)
    .filter((f) => compareVersions(f.template.version, next.template.version) < 0)
    .sort((a, b) => compareVersions(b.template.version, a.template.version))[0];
  const check = checkPublish(previous, next);
  if (!check.ok)
    return {
      ok: false,
      reason: 'refused',
      codes: check.reasons.map((r) => r.code),
      messages: [...check.reasons.map((r) => r.message), ...check.breaking.map((b) => b.message)],
    };
  const r = publishTemplate(control, next, clock);
  if (r.ok) return { ok: true, created: r.created };
  return {
    ok: false,
    reason: 'invalid',
    messages: 'problems' in r ? r.problems.map((p) => `${p.path}: ${p.code}`) : [r.error],
  };
}
