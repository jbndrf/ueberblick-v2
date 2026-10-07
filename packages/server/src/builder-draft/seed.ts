import { stringify } from 'yaml';
import type { OverlayFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { TemplateSource } from '../deploy';
import type { Draft, NewDraft } from './contract';
import { createDraftStore } from './store';

export type EnsureResult =
  { readonly ok: true; readonly draft: Draft } | { readonly ok: false; readonly code: 'no_version' };

interface Deployed {
  template: string | null;
  template_version: string | null;
  overlay: string;
}

/**
 * The draft of a project; the first call creates it from the deployed version (its template and
 * overlay). A plain template deployed without an overlay starts as an empty overlay on that
 * template's major. Nothing deployed yet: `no_version`.
 */
export function ensureDraft(db: Db, clock: { now(): string }, by: string): EnsureResult {
  const store = createDraftStore(db);
  const existing = store.get();
  if (existing) return { ok: true, draft: existing };
  const row = db
    .prepare<Deployed>(
      "SELECT template, template_version, overlay FROM config_versions WHERE status = 'deployed'",
    )
    .get();
  if (!row?.template || !row.template_version) return { ok: false, code: 'no_version' };
  const stored = JSON.parse(row.overlay) as Partial<OverlayFile>;
  const overlay: Partial<OverlayFile> =
    'extends' in stored
      ? stored
      : { schema: 'ueberblick/1', extends: `${row.template}@${row.template_version.split('.')[0]}` };
  return {
    ok: true,
    draft: store.seed({
      template: row.template,
      templateVersion: row.template_version,
      overlay: stringify(overlay),
      by,
      at: clock.now(),
    }),
  };
}

/** Seeds the draft of a project that has no deployed version yet (project creation from a template, WP-309). */
export function seedDraft(db: Db, seed: NewDraft): Draft {
  return createDraftStore(db).seed(seed);
}

/** What the builder opens: the pinned template as source text plus the overlay text. */
export function draftSources(
  draft: Draft,
  templates: TemplateSource,
): { readonly templateSrc: string; readonly overlaySrc: string } | undefined {
  const file = templates.resolve(`${draft.template}@${draft.templateVersion}`);
  return file && { templateSrc: stringify(file), overlaySrc: draft.overlay };
}
