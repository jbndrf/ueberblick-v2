/**
 * The self-join links of a project's roles (WP-639): one row per (project, role) in `join_links` of the control
 * database. The switch (`enabled`) and the `slug` belong to the roster side, not to the project file (owner Q14: a
 * change applies at once and is not part of a draft). `resolveSlug` is one indexed lookup.
 */
import { randomBytes } from 'node:crypto';
import { KeySchema, type Key } from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { JoinErrorCode } from './registry';

export interface SelfJoin {
  readonly role: Key;
  readonly slug: string;
  readonly enabled: boolean;
}

export type JoinFailure = { readonly ok: false; readonly code: JoinErrorCode };

/** What a link opens: the project and the role a guest gets. */
export interface JoinTarget {
  readonly projectId: string;
  readonly projectKey: string;
  readonly role: Key;
}

const SLUG = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** A fresh random slug, used when an admin switches self-join on without choosing one. */
export const generateSlug = (): string => randomBytes(5).toString('hex');

interface Row {
  role: string;
  slug: string;
  enabled: number;
}
const view = (r: Row): SelfJoin => ({ role: r.role as Key, slug: r.slug, enabled: r.enabled === 1 });

export function getSelfJoin(control: Db, projectId: string, role: string): SelfJoin | undefined {
  const r = control
    .prepare<Row>('SELECT role, slug, enabled FROM join_links WHERE project_id = ? AND role = ?')
    .get(projectId, role);
  return r ? view(r) : undefined;
}

export function listSelfJoins(control: Db, projectId: string): readonly SelfJoin[] {
  return control
    .prepare<Row>('SELECT role, slug, enabled FROM join_links WHERE project_id = ? ORDER BY role')
    .all(projectId)
    .map(view);
}

/**
 * Switches the link of a role on or off and/or changes its slug. A role without a link gets one (the given slug, or a
 * generated one). Changing the slug ends the old link at once.
 */
export function setSelfJoin(
  deps: { readonly control: Db; readonly now: () => Date },
  projectId: string,
  role: string,
  input: { readonly enabled: boolean; readonly slug?: string },
): { readonly ok: true; readonly selfJoin: SelfJoin } | JoinFailure {
  const key = KeySchema.safeParse(role);
  if (!key.success) return { ok: false, code: 'role_invalid' };
  const current = getSelfJoin(deps.control, projectId, role);
  const slug = input.slug ?? current?.slug ?? generateSlug();
  if (!SLUG.test(slug)) return { ok: false, code: 'slug_invalid' };
  const other = deps.control
    .prepare<{ project_id: string }>(
      'SELECT project_id FROM join_links WHERE slug = ? AND NOT (project_id = ? AND role = ?)',
    )
    .get(slug, projectId, role);
  if (other) return { ok: false, code: 'slug_taken' };
  deps.control
    .prepare(
      `INSERT INTO join_links (project_id, role, slug, enabled, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT (project_id, role) DO UPDATE SET slug = excluded.slug, enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
    .run(projectId, role, slug, input.enabled ? 1 : 0, deps.now().toISOString());
  return { ok: true, selfJoin: { role: key.data as Key, slug, enabled: input.enabled } };
}

/** The project and role an ENABLED link opens; `undefined` for an unknown or switched-off slug. */
export function resolveSlug(control: Db, slug: string): JoinTarget | undefined {
  const r = control
    .prepare<{ project_id: string; key: string; role: string }>(
      `SELECT l.project_id, p.key, l.role FROM join_links l JOIN projects p ON p.id = l.project_id
       WHERE l.slug = ? AND l.enabled = 1`,
    )
    .get(slug);
  return r ? { projectId: r.project_id, projectKey: r.key, role: r.role as Key } : undefined;
}
