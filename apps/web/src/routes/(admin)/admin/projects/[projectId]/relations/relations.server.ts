/**
 * The Beziehungen page's server side (v3 `relations/+page.server.ts`): the load and the edits. A relation is config,
 * so every edit is a builder Doc op on the project's draft (`relations/ops`) and the publish bar picks it up (WP-326).
 */
import { createDraftStore, draftSources, ensureDraft, type Principal } from '@ueberblick/server';
import {
  createRelation,
  deleteRelation,
  listRelations,
  ON_DELETE_BEHAVIORS,
  openProject,
  RELATION_ATTACHMENTS,
  RELATION_GEOMETRIES,
  typeOptions,
  updateRelation,
  type Doc,
  type RelationEdit,
  type RelationErrorCode,
  type RelationGeometry,
  type RelationInput,
  type RelationOptions,
  type RelationSource,
} from '@ueberblick/builder';
import { localize, type Problem, type TemplateFile } from '@ueberblick/core';
import { runtime } from '../../../../../../lib/server/runtime';
import type {
  DeletePreview,
  RelationCall,
  RelationRowData,
  RelationsPageData,
} from '../../../../../../lib/admin/relations/types';

export type RelationCallResult =
  | { readonly ok: true; readonly body: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: RelationErrorCode; readonly detail?: string };

/** The deployed project file, for a project that has no draft yet (everything in it counts as the template's). */
function deployedSource(projectKey: string): RelationSource | null {
  const row = runtime()
    .projectDb(projectKey)
    .prepare<{ compiled: string }>("SELECT compiled FROM config_versions WHERE status = 'deployed'")
    .get();
  if (!row) return null;
  const file = (JSON.parse(row.compiled) as { file?: TemplateFile }).file;
  return file ? { effective: () => file, provenance: () => 'template' } : null;
}

/** The two options of a call as registry keys; the route checked them, anything else is dropped here. */
function optionsOf(call: {
  readonly attachment?: string;
  readonly onDelete?: string;
  readonly geometry?: string;
}): Partial<RelationOptions> & { geometry?: RelationGeometry } {
  const { attachment, onDelete, geometry } = call;
  return {
    ...(attachment !== undefined && RELATION_ATTACHMENTS.has(attachment) ? { attachment } : {}),
    ...(onDelete !== undefined && ON_DELETE_BEHAVIORS.has(onDelete) ? { onDelete } : {}),
    ...(geometry !== undefined && RELATION_GEOMETRIES.has(geometry) ? { geometry } : {}),
  };
}

const CHOICES = {
  attachments: RELATION_ATTACHMENTS.keys,
  onDelete: ON_DELETE_BEHAVIORS.keys,
  geometries: RELATION_GEOMETRIES.keys,
} as const;

/** The relations of the draft (or, with no draft yet, of the deployed version) with the types to choose from. */
export function loadRelations(projectKey: string, locale: string): RelationsPageData {
  const rt = runtime();
  const draft = createDraftStore(rt.projectDb(projectKey)).get();
  const sources = draft && draftSources(draft, rt.templates);
  const source: RelationSource | null = sources
    ? openProject(sources.templateSrc, sources.overlaySrc)
    : deployedSource(projectKey);
  if (source === null) return { relations: [], types: [], choices: CHOICES };
  const types = typeOptions(source, locale);
  const labelOf = (key: string): string => types.find((t) => t.key === key)?.label ?? key;
  const relations: RelationRowData[] = listRelations(source, locale).map((r) => ({
    ...r,
    geometryProblem: r.geometryProblem !== undefined,
    parentLabel: labelOf(r.parent),
    childLabel: labelOf(r.child),
  }));
  return { relations, types, choices: CHOICES };
}

const useOf = (p: Problem, locale: string) => ({ path: p.path, message: localize(p.message, [locale]) });

/** One edit of the page: create, update, delete, or the dry run of a delete (`uses`). */
export function runRelationCall(
  projectKey: string,
  principal: Principal,
  locale: string,
  call: RelationCall,
): RelationCallResult {
  const by = principal.id;
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, by);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) return { ok: false, code: 'no_version' };
  const doc: Doc = openProject(sources.templateSrc, sources.overlaySrc);
  const revision = ensured.draft.revision;
  const save = (next: Doc): RelationErrorCode | null => {
    const saved = createDraftStore(rt.projectDb(projectKey)).putIf(
      revision,
      next.save().overlaySrc,
      by,
      rt.clock.now(),
    );
    if (!saved.ok) return 'conflict';
    rt.previews.schedulePreviewRefresh(projectKey);
    return null;
  };
  const edited = (r: RelationEdit): RelationCallResult => {
    if (!r.ok) return { ok: false, code: r.code, ...(r.detail ? { detail: r.detail } : {}) };
    const failed = r.doc === doc ? null : save(r.doc);
    return failed ? { ok: false, code: failed } : { ok: true, body: { id: r.id } };
  };
  switch (call.action) {
    case 'create':
      return edited(createRelation(doc, { ...call, ...optionsOf(call) } as RelationInput, locale));
    case 'update':
      return edited(
        updateRelation(doc, call.id, { ...call, ...optionsOf(call) } as Partial<RelationInput>, locale),
      );
    case 'uses':
    case 'delete': {
      const r = deleteRelation(doc, call.id);
      if ('refused' in r) return { ok: false, code: 'refused', detail: r.refused };
      const uses = r.uses.map((p) => useOf(p, locale));
      if (call.action === 'uses') {
        const preview: DeletePreview = { uses, child: r.child, refKey: r.refKey };
        return { ok: true, body: { ...preview } };
      }
      const failed = save(r.doc);
      return failed ? { ok: false, code: failed } : { ok: true, body: { uses } };
    }
  }
}
