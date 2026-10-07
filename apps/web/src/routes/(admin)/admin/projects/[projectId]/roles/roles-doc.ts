/**
 * The Rollen page's edits on the project's document (WP-346, S3-12). A role is config, so create, rename, describe and
 * delete are builder Doc ops (`add` / `set` / `hide` / `reset`) on the draft overlay, never a hand-written YAML edit
 * (R1). Headless: it takes a `Doc` and returns the next one; the server module saves it and the page tells the shell.
 */
import { applyOps, type Doc, type Op } from '@ueberblick/builder';
import {
  defineRegistry,
  localize,
  localizeExact,
  type KeyOf,
  type LocalizedString,
  type Problem,
} from '@ueberblick/core';
import { MIN_NAME } from '../../../../../../lib/admin/roles/limits';

/** One role as the page lists it. */
export interface RoleEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** Provenance of the role: added by the overlay (not yet published when the draft is new) or from the template. */
  readonly source: 'template' | 'overlay';
  /** `roles.<key>.quota`: the most features a participant of this role may create (WP-367); 0 = no limit. */
  readonly quota: number;
  /** The name of the role's home view (`roles.<key>.app.home`), or '' when none is set (WP-367: "Landet auf"). */
  readonly home: string;
}

interface RoleFileEntry {
  readonly label?: LocalizedString;
  readonly description?: LocalizedString;
  readonly quota?: number;
  readonly app?: { readonly home?: string };
}

/** A role key from a typed name: ASCII, lowercase, `^[a-z][a-z0-9_]*$` (a v3 role name was free text). */
export function roleKeyOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (slug === '') return 'rolle';
  return /^[a-z]/.test(slug) ? slug : `r_${slug}`;
}

const rolesOf = (doc: Doc): Readonly<Record<string, RoleFileEntry>> =>
  (doc.effective().roles ?? {}) as Readonly<Record<string, RoleFileEntry>>;

/** One role of a project file (the draft's effective file or the deployed one) as the page lists it. */
export function roleEntryOf(
  key: string,
  role: RoleFileEntry,
  views: Readonly<Record<string, { readonly label?: LocalizedString }>>,
  locale: string,
  source: RoleEntry['source'],
): RoleEntry {
  const home = role.app?.home;
  return {
    key,
    label: localize(role.label, [locale]) || key,
    description: localize(role.description, [locale]),
    source,
    quota: role.quota ?? 0,
    home: home === undefined ? '' : localize(views[home]?.label, [locale]) || home,
  };
}

export function listRoles(doc: Doc, locale: string): readonly RoleEntry[] {
  const views = (doc.effective().views ?? {}) as Readonly<Record<string, { label?: LocalizedString }>>;
  return Object.entries(rolesOf(doc)).map(([key, role]) =>
    roleEntryOf(
      key,
      role,
      views,
      locale,
      doc.provenance(`roles.${key}`) === 'added' ? 'overlay' : 'template',
    ),
  );
}

/** `text` for one language: a plain string is replaced, a language object gets (or loses) its entry for `locale`. */
function withLocale(existing: LocalizedString | undefined, locale: string, text: string): LocalizedString {
  if (existing === undefined || typeof existing === 'string') return text;
  return { ...existing, [locale]: text };
}

/** Why a role edit was not made (R6); the route turns each into the page's refusal text. */
export const ROLE_ERRORS = defineRegistry([
  {
    key: 'name_short',
    description: 'The name has fewer than two characters (v3: rolesServerNameMinLength).',
  },
  {
    key: 'quota_invalid',
    description: 'The quota is not a non-negative whole number (v3: rolesQuotaInvalid).',
  },
  { key: 'unknown_role', description: 'The project file has no role with this key.' },
  { key: 'refused', description: 'The document model refused the edit (a lock, a schema problem).' },
  { key: 'no_version', description: 'Nothing is deployed yet, so there is no draft to edit.' },
  { key: 'conflict', description: 'The draft was saved by someone else in the meantime.' },
] as const);
export type RoleErrorCode = KeyOf<typeof ROLE_ERRORS>;
export type RoleEdit =
  | { readonly ok: true; readonly doc: Doc; readonly key: string }
  | { readonly ok: false; readonly code: RoleErrorCode; readonly detail?: string };

const apply = (doc: Doc, ops: readonly Op[], key: string): RoleEdit => {
  const r = applyOps(doc, ops);
  return 'refused' in r
    ? { ok: false, code: 'refused', detail: r.refused.message }
    : { ok: true, doc: r.doc, key };
};

/** Whether a typed name is accepted: at least MIN_NAME characters after trimming (v3), so `'x '` is refused on purpose. */
export const isRoleName = (name: string): boolean => name.trim().length >= MIN_NAME;

/** v3 "Rolle erstellen": name and description. The key comes from the name; the same name twice is two roles. */
export function createRole(
  doc: Doc,
  input: { readonly name: string; readonly description?: string },
): RoleEdit {
  const name = input.name.trim();
  if (!isRoleName(name)) return { ok: false, code: 'name_short' };
  const taken = new Set(Object.keys(rolesOf(doc)));
  const base = roleKeyOf(name);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  const description = (input.description ?? '').trim();
  const value: Record<string, unknown> = { label: name };
  if (description !== '') value['description'] = description;
  return apply(doc, [{ kind: 'add', path: `roles.${key}`, value }], key);
}

/** Rename and/or describe in place; the key never changes. An empty description removes it. */
export function updateRole(
  doc: Doc,
  key: string,
  patch: { readonly name?: string; readonly description?: string },
  locale: string,
): RoleEdit {
  const role = rolesOf(doc)[key];
  if (!role) return { ok: false, code: 'unknown_role', detail: key };
  const ops: Op[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!isRoleName(name)) return { ok: false, code: 'name_short' };
    if (name !== localizeExact(role.label ?? null, locale))
      ops.push({ kind: 'set', path: `roles.${key}.label`, value: withLocale(role.label, locale, name) });
  }
  if (patch.description !== undefined) {
    const text = patch.description.trim();
    if (text === '') {
      if (role.description !== undefined)
        ops.push(
          typeof role.description === 'string' || Object.keys(role.description).length <= 1
            ? {
                kind: doc.provenance(`roles.${key}.description`) === 'added' ? 'reset' : 'hide',
                path: `roles.${key}.description`,
              }
            : {
                kind: 'set',
                path: `roles.${key}.description`,
                value: withLocale(role.description, locale, ''),
              },
        );
    } else if (text !== localizeExact(role.description ?? null, locale))
      ops.push({
        kind: 'set',
        path: `roles.${key}.description`,
        value: withLocale(role.description, locale, text),
      });
  }
  return ops.length === 0 ? { ok: true, doc, key } : apply(doc, ops, key);
}

/**
 * The role's creation quota (v3 "Max. Arbeitsabläufe pro Teilnehmer:in", WP-367). It is config (`roles.<key>.quota`),
 * so it is a draft edit like the name. 0 means "unbegrenzt" and removes the key; the schema allows only positive ones.
 */
export function setQuota(doc: Doc, key: string, quota: number): RoleEdit {
  const role = rolesOf(doc)[key];
  if (!role) return { ok: false, code: 'unknown_role', detail: key };
  if (!Number.isInteger(quota) || quota < 0) return { ok: false, code: 'quota_invalid' };
  const path = `roles.${key}.quota`;
  if (quota === 0) {
    if (role.quota === undefined) return { ok: true, doc, key };
    return apply(doc, [{ kind: doc.provenance(path) === 'added' ? 'reset' : 'hide', path }], key);
  }
  if (role.quota === quota) return { ok: true, doc, key };
  return apply(
    doc,
    [role.quota === undefined ? { kind: 'add', path, value: quota } : { kind: 'set', path, value: quota }],
    key,
  );
}

export interface RoleDeletion {
  readonly doc: Doc;
  /** The problems the deletion causes (rules, permissions, views that name the role): the Doc's own, new ones. */
  readonly uses: readonly Problem[];
}

const problemKey = (p: Problem): string => `${p.code}|${p.path}|${JSON.stringify(p.message)}`;

/**
 * Deletes roles: a role the overlay added is dropped (`reset`), one from the template is hidden (`hide`). `uses` are
 * the problems that appear with the deletion, straight from the Doc (core's compile): no second checker (R1).
 */
export function deleteRoles(doc: Doc, keys: readonly string[]): RoleDeletion | { readonly refused: string } {
  const have = rolesOf(doc);
  const ops: Op[] = [];
  for (const key of keys) {
    if (!have[key]) return { refused: key };
    ops.push({
      kind: doc.provenance(`roles.${key}`) === 'added' ? 'reset' : 'hide',
      path: `roles.${key}`,
    });
  }
  const before = new Set(doc.problems().map(problemKey));
  const r = applyOps(doc, ops);
  if ('refused' in r) return { refused: r.refused.message };
  return { doc: r.doc, uses: r.problems.filter((p) => !before.has(problemKey(p))) };
}
