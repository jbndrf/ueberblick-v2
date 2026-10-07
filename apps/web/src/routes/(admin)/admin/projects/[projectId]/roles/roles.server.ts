/**
 * The Rollen page's server side (v3 `roles/+page.server.ts`): the load and the edits. Roles are config, so every edit
 * goes through the builder Doc on the project's draft (`roles-doc.ts`, Q13) and the publish bar picks it up; who has a
 * role is roster data and is changed by `setRoleMembers` (WP-310), not here.
 */
import {
  listSelfJoins,
  createDraftStore,
  draftSources,
  ensureDraft,
  listParticipants,
  type Principal,
} from '@ueberblick/server';
import { openProject, type Doc } from '@ueberblick/builder';
import { localize, type Problem } from '@ueberblick/core';
import { runtime } from '../../../../../../lib/server/runtime';
import {
  createRole,
  deleteRoles,
  listRoles,
  roleEntryOf,
  setQuota,
  updateRole,
  type RoleEdit,
  type RoleErrorCode,
  type RoleEntry,
} from './roles-doc';
import type {
  DeletePreview,
  RoleCall,
  RolePerson,
  RoleRowData,
  RolesPageData,
} from '../../../../../../lib/admin/roles/types';

export type RoleCallResult =
  | { readonly ok: true; readonly body: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: RoleErrorCode; readonly detail?: string };

interface RosterPerson extends RolePerson {
  readonly roles: readonly string[];
}

const roster = (projectKey: string): readonly RosterPerson[] => {
  const rt = runtime();
  return listParticipants({ db: rt.projectDb(projectKey) }, { guests: true }).map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    roles: p.roles as readonly string[],
  }));
};

function deployedRoles(projectKey: string, locale: string): readonly RoleEntry[] {
  const db = runtime().projectDb(projectKey);
  const row = db
    .prepare<{ compiled: string }>("SELECT compiled FROM config_versions WHERE status = 'deployed'")
    .get();
  const file = row
    ? (JSON.parse(row.compiled) as { file?: { roles?: Record<string, unknown> } }).file
    : undefined;
  const views = ((file as { views?: Parameters<typeof roleEntryOf>[2] } | undefined)?.views ??
    {}) as Parameters<typeof roleEntryOf>[2];
  return Object.entries(file?.roles ?? {}).map(([key, role]) =>
    roleEntryOf(key, role as Parameters<typeof roleEntryOf>[1], views, locale, 'template'),
  );
}

/** The roles of the draft (or, with no draft yet, of the deployed version) with who has each. */
export function loadRoles(projectKey: string, locale: string): RolesPageData {
  const rt = runtime();
  const draft = createDraftStore(rt.projectDb(projectKey)).get();
  const sources = draft && draftSources(draft, rt.templates);
  const entries = sources
    ? listRoles(openProject(sources.templateSrc, sources.overlaySrc), locale)
    : deployedRoles(projectKey, locale);
  const people = roster(projectKey);
  const projectId = rt.project(projectKey)?.id;
  const links = new Map(
    (projectId ? listSelfJoins(rt.control, projectId) : []).map((l) => [l.role as string, l]),
  );
  const roles: RoleRowData[] = entries.map((r) => {
    const link = links.get(r.key);
    return {
      key: r.key,
      label: r.label,
      description: r.description,
      members: people.filter((p) => p.roles.includes(r.key)).map((p) => p.id),
      selfJoin: link ? { enabled: link.enabled, slug: link.slug } : null,
      quota: r.quota,
      home: r.home,
    };
  });
  return { roles, people: people.map(({ id, name }) => ({ id, name })) };
}

const useOf = (p: Problem, locale: string) => ({ path: p.path, message: localize(p.message, [locale]) });

/** The draft's Doc (the draft is created from the deployed version on first use) and the revision a save must name. */
function openDoc(projectKey: string, by: string): { doc: Doc; revision: number } | null {
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, by);
  if (!ensured.ok) return null;
  const sources = draftSources(ensured.draft, rt.templates);
  if (!sources) return null;
  return { doc: openProject(sources.templateSrc, sources.overlaySrc), revision: ensured.draft.revision };
}

function save(projectKey: string, by: string, revision: number, doc: Doc): RoleErrorCode | null {
  const rt = runtime();
  const saved = createDraftStore(rt.projectDb(projectKey)).putIf(
    revision,
    doc.save().overlaySrc,
    by,
    rt.clock.now(),
  );
  if (!saved.ok) return 'conflict';
  rt.previews.schedulePreviewRefresh(projectKey);
  return null;
}

/** One edit of the page: create, rename or describe, delete, or the dry run of a delete (`uses`). */
export function runRoleCall(
  projectKey: string,
  principal: Principal,
  locale: string,
  call: RoleCall,
): RoleCallResult {
  const by = principal.id;
  const opened = openDoc(projectKey, by);
  if (!opened) return { ok: false, code: 'no_version' };
  const { doc, revision } = opened;
  const edited = (r: RoleEdit, body: (key: string) => Record<string, unknown>): RoleCallResult => {
    if (!r.ok) return { ok: false, code: r.code, ...(r.detail ? { detail: r.detail } : {}) };
    const failed = r.doc === doc ? null : save(projectKey, by, revision, r.doc);
    return failed ? { ok: false, code: failed } : { ok: true, body: body(r.key) };
  };
  switch (call.action) {
    case 'create':
      return edited(createRole(doc, call), (key) => ({ key }));
    case 'update':
      return edited(updateRole(doc, call.key, call, locale), (key) => ({ key }));
    case 'quota':
      return edited(setQuota(doc, call.key, call.quota), (key) => ({ key }));
    case 'uses':
    case 'delete': {
      const r = deleteRoles(doc, call.keys);
      if ('refused' in r) return { ok: false, code: 'refused', detail: r.refused };
      const uses = r.uses.map((p) => useOf(p, locale));
      if (call.action === 'uses') {
        const keys = new Set(call.keys);
        const people = roster(projectKey)
          .filter((p) => p.roles.some((k) => keys.has(k)))
          .map(({ id, name }) => ({ id, name }));
        const preview: DeletePreview = { uses, people };
        return { ok: true, body: { ...preview } };
      }
      const failed = save(projectKey, by, revision, r.doc);
      return failed ? { ok: false, code: failed } : { ok: true, body: { uses } };
    }
  }
}
