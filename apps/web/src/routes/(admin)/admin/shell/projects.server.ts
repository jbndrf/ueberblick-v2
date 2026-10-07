/** What the shell reads from the control database: the signed-in account and its projects. Server only. */
import { draftSources, ensureDraft } from '@ueberblick/server';
import { merge, OverlayFileSchema, TemplateFileSchema } from '@ueberblick/core';
import { parse } from 'yaml';
import { runtime } from '../../../../lib/server/runtime';
import type { ShellProject } from './nav';
import { sidebarTypesOf, type SidebarType } from './sidebar-types';

/** The admin's projects: the ones with a membership, by name. */
export function projectsOf(accountId: string): ShellProject[] {
  return runtime()
    .control.prepare<{ key: string; name: string }>(
      'SELECT p.key AS key, p.name AS name FROM memberships m JOIN projects p ON p.id = m.project_id WHERE m.account_id = ? ORDER BY p.name, p.key',
    )
    .all(accountId);
}

/** The e-mail of an admin account, or null for an unknown id. */
export function emailOf(accountId: string): string | null {
  return (
    runtime()
      .control.prepare<{ email: string | null }>('SELECT email FROM accounts WHERE id = ?')
      .get(accountId)?.email ?? null
  );
}

/**
 * The types the sidebar lists: those of the project's draft (A-011), so a new or reordered type shows before
 * it is published. Nothing deployed yet, or an overlay that does not open, gives an empty list.
 */
export function typesOf(project: string, accountId: string, locale: string): SidebarType[] {
  const rt = runtime();
  const opened = ensureDraft(rt.projectDb(project), rt.clock, accountId); // as the builder opens it (A-011)
  const draft = opened.ok ? (draftSources(opened.draft, rt.templates) ?? null) : null;
  if (draft === null) return [];
  try {
    // The effective file the builder shows, without loading the builder package (the layout load stays light).
    const template = TemplateFileSchema.parse(parse(draft.templateSrc));
    const overlay = OverlayFileSchema.parse(parse(draft.overlaySrc));
    return sidebarTypesOf(merge(template, overlay).file, locale);
  } catch {
    return [];
  }
}
