/**
 * One edit of the project's draft from a data page call: open the draft (made when there is none), let `edit` return the
 * next Doc, save it if it changed (a stale revision is a conflict) and refresh the previews. The header (WP-418) and the ⋮
 * menu (WP-419) save the same way, so the draft is written in one place (R1, R3).
 */
import { openProject, type Doc } from '@ueberblick/builder';
import type { TemplateFile } from '@ueberblick/core';
import { createDraftStore, draftSources, ensureDraft, type Principal } from '@ueberblick/server';
import { runtime } from '../../../../../../../lib/server/runtime';

export type Edit<T, C extends string> =
  | { readonly ok: true; readonly doc: Doc; readonly value: T }
  | { readonly ok: false; readonly code: C; readonly detail?: string };

export type Saved<T, C extends string> =
  | { readonly ok: true; readonly doc: Doc; readonly value: T }
  | { readonly ok: false; readonly code: C | 'no_version' | 'conflict'; readonly detail?: string };

export function editDraft<T, C extends string>(
  projectKey: string,
  principal: Principal,
  edit: (doc: Doc) => Edit<T, C>,
): Saved<T, C> {
  const by = principal.id;
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, by);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) return { ok: false, code: 'no_version' };
  const doc = openProject(sources.templateSrc, sources.overlaySrc);
  const r = edit(doc);
  if (!r.ok) return r;
  if (r.doc !== doc) {
    const saved = createDraftStore(rt.projectDb(projectKey)).putIf(
      ensured.draft.revision,
      r.doc.save().overlaySrc,
      by,
      rt.clock.now(),
    );
    if (!saved.ok) return { ok: false, code: 'conflict' };
    rt.previews.schedulePreviewRefresh(projectKey);
  }
  return r;
}

/** The deployed project file, for a project that has no draft yet. */
function deployedFile(projectKey: string): TemplateFile | null {
  const row = runtime()
    .projectDb(projectKey)
    .prepare<{ compiled: string }>("SELECT compiled FROM config_versions WHERE status = 'deployed'")
    .get();
  return row ? ((JSON.parse(row.compiled) as { file?: TemplateFile }).file ?? null) : null;
}

/** The project's draft as a document (or, with no draft yet, the deployed file); null when it has neither. */
export function draftOrDeployed(projectKey: string): (Doc | { effective(): TemplateFile }) | null {
  const rt = runtime();
  const draft = createDraftStore(rt.projectDb(projectKey)).get();
  const sources = draft && draftSources(draft, rt.templates);
  return sources
    ? openProject(sources.templateSrc, sources.overlaySrc)
    : ((file) => (file ? { effective: () => file } : null))(deployedFile(projectKey));
}
