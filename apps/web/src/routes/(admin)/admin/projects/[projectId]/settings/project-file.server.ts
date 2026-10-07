/**
 * "Projektdatei" (owner 2026-10-05): the draft's whole project file as text, and applying a pasted or edited one to the
 * DRAFT only. The text is the draft's overlay file (`extends` plus the entries), the same text the builder's Doc keeps.
 * It is checked by the builder Doc's own `replaceOverlay` and problems list (R1, no second parser) and stored through
 * the draft store's compare-and-swap, as every settings save is (R3). Any blocking problem applies nothing.
 */
import { createDraftStore, draftSources, ensureDraft, type Principal } from '@ueberblick/server';
import { DocOpenError, openProject, problemItems } from '@ueberblick/builder';
import { compile, NO_ASSETS, TemplateFileSchema, type Problem } from '@ueberblick/core';
import { runtime } from '../../../../../../lib/server/runtime';

export interface FileProblem {
  readonly path: string;
  readonly message: string;
}

export type ProjectFileRead =
  { readonly ok: true; readonly text: string; readonly revision: number } | { readonly ok: false };

export type ProjectFileApply =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly conflict: boolean; readonly problems: FileProblem[] };

const keyOf = (p: Problem): string => `${p.code} ${p.path}`;

export function readProjectFile(projectKey: string, by: string): ProjectFileRead {
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, by);
  return ensured.ok
    ? { ok: true, text: ensured.draft.overlay, revision: ensured.draft.revision }
    : { ok: false };
}

export function applyProjectFile(
  projectKey: string,
  principal: Principal,
  locale: string,
  text: string,
  revision: number,
): ProjectFileApply {
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, principal.id);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : undefined;
  if (!ensured.ok || !sources) return { ok: false, conflict: false, problems: [] };
  if (ensured.draft.revision !== revision) return { ok: false, conflict: true, problems: [] };
  let doc;
  try {
    doc = openProject(sources.templateSrc, sources.overlaySrc);
  } catch (e) {
    if (e instanceof DocOpenError)
      return { ok: false, conflict: false, problems: [{ path: '', message: e.message }] };
    throw e;
  }
  const replaced = doc.replaceOverlay(text);
  if (replaced.refused)
    return { ok: false, conflict: false, problems: [{ path: '', message: replaced.refused.message }] };
  // Warnings do not block (as at deploy); everything else does.
  const shape = TemplateFileSchema.safeParse(replaced.doc.effective());
  const compiled = shape.success ? compile(shape.data, { assets: NO_ASSETS }) : undefined;
  const warned = new Set(compiled?.ok ? compiled.warnings.map(keyOf) : []);
  const raw = replaced.doc.problems();
  const blocking = problemItems(replaced.doc, locale).filter((_, i) => {
    const p = raw[i];
    return p === undefined || !warned.has(keyOf(p));
  });
  if (blocking.length > 0)
    return {
      ok: false,
      conflict: false,
      problems: blocking.map((p) => ({ path: p.path, message: p.message })),
    };
  const saved = createDraftStore(rt.projectDb(projectKey)).putIf(
    revision,
    replaced.doc.save().overlaySrc,
    principal.id,
    rt.clock.now(),
  );
  if (!saved.ok) return { ok: false, conflict: true, problems: [] };
  rt.previews.schedulePreviewRefresh(projectKey);
  return { ok: true, revision: saved.draft.revision };
}
