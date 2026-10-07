/**
 * The roles of a project as the Teilnehmende page offers them, and the one write the page makes to the draft: a role
 * typed in a participant's Rollen cell (Q13: a change outside the builder goes into the draft; participants themselves
 * do not). Roles that exist only in the draft are "pending" until the next publish.
 */
import { localize } from '@ueberblick/core';
import { openProject } from '@ueberblick/builder';
import { createDraftStore, draftSources, ensureDraft } from '@ueberblick/server';
import { createRole, type RoleErrorCode } from '../roles/roles-doc';
import { runtime } from '../../../../../../lib/server/runtime';
import type { RoleOption } from '../../../../../../lib/admin/participants/types';

interface RoleFile {
  readonly roles?: Readonly<Record<string, { readonly label?: unknown }>> | undefined;
}

const labelOf = (key: string, role: { label?: unknown } | undefined, locale: string): string =>
  localize((role?.label ?? undefined) as Parameters<typeof localize>[0], [locale]) || key;

/** The deployed roles, then the roles only the draft has (marked pending). */
export function roleOptions(projectKey: string, locale: string): readonly RoleOption[] {
  const rt = runtime();
  const db = rt.projectDb(projectKey);
  const out = new Map<string, RoleOption>();
  const deployed = db
    .prepare<{ compiled: string }>("SELECT compiled FROM config_versions WHERE status = 'deployed'")
    .get();
  if (deployed) {
    const file = (JSON.parse(deployed.compiled) as { file?: RoleFile }).file;
    for (const [key, role] of Object.entries(file?.roles ?? {}))
      out.set(key, { key, label: labelOf(key, role, locale), pending: false });
  }
  const draft = createDraftStore(db).get();
  const sources = draft && draftSources(draft, rt.templates);
  if (sources) {
    try {
      const effective: RoleFile = openProject(sources.templateSrc, sources.overlaySrc).effective();
      for (const [key, role] of Object.entries(effective.roles ?? {})) {
        const known = out.get(key);
        out.set(key, { key, label: labelOf(key, role, locale), pending: known === undefined });
      }
    } catch {
      // A draft in progress may not open; the deployed roles are then the whole list.
    }
  }
  return [...out.values()];
}

/** Why a role typed in the Rollen cell could not go into the draft: the Rollen page's codes (R6, one registry). */
export type AddRoleError = RoleErrorCode;

export type AddRoleResult =
  | { readonly ok: true; readonly role: RoleOption }
  | { readonly ok: false; readonly code: AddRoleError; readonly detail?: string };

/**
 * Adds `roles.<key> = { label }` to the draft overlay (the draft is created from the deployed version on first use).
 * A role with this key already there is returned as it is, so typing the same name twice is harmless.
 */
export function addRoleToDraft(projectKey: string, by: string, name: string, locale: string): AddRoleResult {
  const label = name.trim();
  const rt = runtime();
  const db = rt.projectDb(projectKey);
  const ensured = ensureDraft(db, rt.clock, by);
  if (!ensured.ok) return { ok: false, code: 'no_version' };
  const sources = draftSources(ensured.draft, rt.templates);
  if (!sources) return { ok: false, code: 'no_version' };
  const doc = openProject(sources.templateSrc, sources.overlaySrc);
  // typing a name a role already has returns that role
  const same = Object.entries((doc.effective() as RoleFile).roles ?? {}).find(
    ([key, role]) => labelOf(key, role, locale) === label,
  );
  if (same) return { ok: true, role: { key: same[0], label, pending: false } };
  const made = createRole(doc, { name: label });
  if (!made.ok) return { ok: false, code: made.code, ...(made.detail ? { detail: made.detail } : {}) };
  const saved = createDraftStore(db).putIf(
    ensured.draft.revision,
    made.doc.save().overlaySrc,
    by,
    rt.clock.now(),
  );
  if (!saved.ok) return { ok: false, code: 'conflict' };
  rt.previews.schedulePreviewRefresh(projectKey);
  return { ok: true, role: { key: made.key, label, pending: true } };
}
