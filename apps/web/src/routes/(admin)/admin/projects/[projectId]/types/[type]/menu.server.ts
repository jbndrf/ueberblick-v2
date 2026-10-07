/**
 * The ⋮ menu's server side (v3 `W/+page.server.ts:488-537`: `duplicate`, `importFromProject`, `deleteWorkflow`): each call
 * is one edit of the project's draft with the builder's copy and remove ops (`@ueberblick/builder`, WP-419), saved by
 * `editDraft`; nothing is deleted here. The publish bar picks the draft up and the deploy overview (WP-360) names the
 * Objekte that a removal affects. The import reads another project's *deployed* file, only of a project this admin is a
 * member of (the same list as the Projekte page).
 */
import { fail, type ActionFailure } from '@sveltejs/kit';
import {
  applyOps,
  DROPPED,
  duplicateTypeOps,
  footprint,
  importTypeOps,
  removeType,
  type Doc,
  type Dropped,
  type DroppedKind,
} from '@ueberblick/builder';
import { localize, type Problem, type TemplateFile } from '@ueberblick/core';
import { listProjects, type Principal } from '@ueberblick/server';
import {
  MENU_ACTIONS,
  type ImportSource,
  type MenuAnswer,
  type MenuCall,
  type MenuErrorCode,
} from '../../../../../../../lib/admin/data/menu-types';
import { runtime } from '../../../../../../../lib/server/runtime';
import { type Locale } from '../../../../shell/locale';
import { adminMessage, type AdminKey } from '../../../../shell/messages';
import { run } from '../../tables/table-ops';
import { draftOrDeployed, editDraft, type Edit } from './edit.server';
import { featureCount } from './header.server';

const REFUSAL: Record<MenuErrorCode, AdminKey> = {
  unknown_type: 'data_err_unknown_type',
  no_source: 'data_menu_err_no_source',
  problem: 'data_err_problem',
  refused: 'data_err_refused',
  no_version: 'data_err_no_version',
  conflict: 'data_err_conflict',
};
const WITH_DETAIL: readonly MenuErrorCode[] = ['problem', 'refused'];
const NOTE: Record<DroppedKind, AdminKey> = {
  [DROPPED.relation]: 'data_menu_note_relation',
  [DROPPED.property]: 'data_menu_note_property',
  [DROPPED.target]: 'data_menu_note_target',
  [DROPPED.task]: 'data_menu_note_task',
  [DROPPED.rule]: 'data_menu_note_rule',
  [DROPPED.permissions]: 'data_menu_note_permissions',
};

export const isMenuCall = (b: unknown): b is MenuCall =>
  typeof b === 'object' && b !== null && MENU_ACTIONS.has(String((b as { action?: unknown }).action));

type Outcome =
  | { readonly ok: true; readonly answer: MenuAnswer }
  | { readonly ok: false; readonly code: MenuErrorCode; readonly detail?: string };

const refuse = (code: MenuErrorCode, detail?: string): Outcome => ({
  ok: false,
  code,
  ...(detail === undefined ? {} : { detail }),
});

const notes = (locale: Locale, dropped: readonly Dropped[]): string[] =>
  dropped.map((d) => adminMessage(locale, NOTE[d.kind], { key: d.key ?? '', type: d.type ?? '' }));

/** The other projects of the admin with a deployed version, each with its deployed types. */
function sourcesOf(admin: Principal, current: string, locale: Locale): readonly ImportSource[] {
  const rt = runtime();
  return listProjects(rt.control, rt.projectDb, admin.id)
    .filter((p) => p.key !== current && p.published)
    .map((p) => ({
      key: p.key,
      name: p.name,
      types: Object.entries(rt.services.deployed(p.key)?.config.file.types ?? {}).map(([key, t]) => ({
        key,
        label: localize(t.label, [locale]) || key,
      })),
    }));
}

/** The values (observations) of the type's Objekte: one indexed join, asked only when the delete dialog opens. */
function valueCount(projectKey: string, type: string): number {
  return (
    runtime()
      .projectDb(projectKey)
      .prepare<{ n: number }>(
        'SELECT COUNT(*) AS n FROM observations o JOIN features f ON f.id = o.feature_id WHERE f.type = ?',
      )
      .get(type)?.n ?? 0
  );
}

type Copy = {
  readonly key: string;
  readonly dropped: readonly Dropped[];
  /** Problems the copy brings into the file (an import whose roles are missing here): reported, the admin fixes them. */
  readonly problems: readonly string[];
};

const problemKey = (p: Problem): string => `${p.code}|${p.path}|${JSON.stringify(p.message)}`;

/**
 * The copy's ops on the draft. A duplicate must add no problem (it is the same file: `run` refuses otherwise). An import
 * brings another project's design, which may need this project's roles or fields: it lands as it is and the new problems
 * are listed, as v3 asked the admin to configure an imported workflow afterwards.
 */
function copyEdit(
  doc: Doc,
  copy: ReturnType<typeof duplicateTypeOps>,
  locale: Locale,
  strict: boolean,
): Edit<Copy, MenuErrorCode> {
  if (copy.ops.length === 0) return { ok: false, code: 'unknown_type' };
  if (strict) {
    const r = run(doc, copy.ops, locale, copy.key);
    if (!r.ok)
      return {
        ok: false,
        code: r.code === 'problem' ? 'problem' : 'refused',
        ...(r.detail ? { detail: r.detail } : {}),
      };
    return { ok: true, doc: r.doc, value: { key: copy.key, dropped: copy.dropped, problems: [] } };
  }
  const before = new Set(doc.problems().map(problemKey));
  const r = applyOps(doc, copy.ops);
  if ('refused' in r) return { ok: false, code: 'refused', detail: r.refused.message };
  const problems = r.problems
    .filter((p) => !before.has(problemKey(p)))
    .map((p) => localize(p.message, [locale]) || p.code);
  return { ok: true, doc: r.doc, value: { key: copy.key, dropped: copy.dropped, problems } };
}

const copied = (r: ReturnType<typeof editDraft<Copy, MenuErrorCode>>, locale: Locale): Outcome =>
  r.ok
    ? {
        ok: true,
        answer: {
          kind: 'copy',
          copy: { key: r.value.key, notes: [...notes(locale, r.value.dropped), ...r.value.problems] },
        },
      }
    : refuse(r.code, r.detail);

/** One call of the menu; the edits are saved to the draft. */
export function runMenuCall(
  projectKey: string,
  principal: Principal,
  locale: Locale,
  type: string,
  call: MenuCall,
): Outcome {
  switch (call.action) {
    case 'sources':
      return { ok: true, answer: { kind: 'sources', sources: sourcesOf(principal, projectKey, locale) } };
    case 'counts': {
      const file: TemplateFile | undefined = draftOrDeployed(projectKey)?.effective();
      if (file?.types?.[type] === undefined) return refuse('unknown_type');
      return {
        ok: true,
        answer: {
          kind: 'counts',
          counts: {
            ...footprint(file, type),
            objects: featureCount(projectKey, type),
            values: valueCount(projectKey, type),
          },
        },
      };
    }
    case 'duplicate':
      return copied(
        editDraft(projectKey, principal, (doc) =>
          copyEdit(doc, duplicateTypeOps(doc.effective(), type, locale), locale, true),
        ),
        locale,
      );
    case 'import': {
      const source = sourcesOf(principal, projectKey, locale).find((s) => s.key === call.project);
      const file = source && runtime().services.deployed(call.project)?.config.file;
      if (!file || file.types?.[call.type] === undefined) return refuse('no_source');
      return copied(
        editDraft(projectKey, principal, (doc) =>
          copyEdit(doc, importTypeOps(file, call.type, doc.effective(), locale), locale, false),
        ),
        locale,
      );
    }
    case 'remove': {
      const r = editDraft(projectKey, principal, (doc): Edit<readonly string[], MenuErrorCode> => {
        const removed = removeType(doc, type);
        if (!removed.ok) return { ok: false, code: 'refused', detail: removed.detail };
        return {
          ok: true,
          doc: removed.doc,
          value: removed.dangling.map((p) => localize(p.message, [locale]) || p.code),
        };
      });
      return r.ok ? { ok: true, answer: { kind: 'removed', notes: r.value } } : refuse(r.code, r.detail);
    }
  }
}

const message = (code: MenuErrorCode, detail?: string): { de: string; en: string } => {
  const add = detail !== undefined && WITH_DETAIL.includes(code) ? `: ${detail}` : '';
  return { de: adminMessage('de', REFUSAL[code]) + add, en: adminMessage('en', REFUSAL[code]) + add };
};

/** The action's answer: the menu answer, or the refusal in both page languages. */
export function menuAnswer(o: Outcome): MenuAnswer | ActionFailure<{ message: { de: string; en: string } }> {
  return o.ok ? o.answer : fail(o.code === 'conflict' ? 409 : 400, { message: message(o.code, o.detail) });
}
