/**
 * The Chat section's edits on the project's draft (WP-391, v3 `ChatSection`). v3 had `chat_enabled` and
 * `chat_visible_to_roles` on the project row; v4 keeps them as the chat tool's keys (B-020, WP-682):
 * `tools.chat` declares the tool, and `roles.<role>.app.tools.chat` gives a role the chat. Who has the chat is read
 * through `toolAvailabilityFor` only (R1); this module never re-derives it. Headless, like `settings-doc.ts`.
 *
 * "Leer = alle": a role without its own `app.tools` has every project tool. Taking the chat from such a role writes
 * its `app.tools` as the list of the project's other tools, so no other tool changes for any role.
 */
import { applyOps, type Doc, type Op } from '@ueberblick/builder';
import { localize, toolAvailabilityFor, type TemplateFile } from '@ueberblick/core';
import type { ChatView } from '../../../../../../lib/admin/settings/types';
import type { SettingsEdit } from './settings-doc';

export type ChatEdit = SettingsEdit;

const CHAT = 'chat';

interface RoleLike {
  readonly label?: unknown;
  readonly description?: unknown;
  readonly app?: { readonly tools?: Readonly<Record<string, unknown>> | undefined } | undefined;
}
const rolesOf = (file: TemplateFile): Readonly<Record<string, RoleLike>> =>
  (file as { roles?: Readonly<Record<string, RoleLike>> }).roles ?? {};

/** The file as if the project declared the chat tool: who would have it once it is on (a hidden section shows it too). */
const declared = (file: TemplateFile): TemplateFile => ({
  ...file,
  tools: { ...file.tools, [CHAT]: file.tools?.[CHAT] ?? {} },
});

/** What the section shows: the switch, the roles that have the chat, and every role as an option. */
export function chatView(file: TemplateFile, locale: string): ChatView {
  const roles = rolesOf(file);
  const keys = Object.keys(roles);
  const withChat = keys.filter((r) => toolAvailabilityFor(declared(file), [r], CHAT) !== undefined);
  const all = keys.length > 0 && withChat.length === keys.length;
  return {
    enabled: file.tools !== undefined && Object.hasOwn(file.tools, CHAT),
    all,
    roles: all ? [] : withChat,
    options: keys.map((key) => {
      const role = roles[key];
      const description = typeof role?.description === 'string' ? role.description : '';
      return {
        key,
        label: localize((role?.label ?? undefined) as Parameters<typeof localize>[0], [locale]) || key,
        ...(description === '' ? {} : { description }),
      };
    }),
  };
}

const refused = (message: string): SettingsEdit => ({ ok: false, code: 'refused', detail: message });

function run(doc: Doc, ops: readonly Op[]): SettingsEdit {
  const r = applyOps(doc, ops);
  if ('refused' in r) return refused(r.refused.message);
  return { ok: true, doc: r.doc };
}

const present = (doc: Doc, path: string): boolean =>
  path
    .split('.')
    .reduce<unknown>((at, k) => (at as Record<string, unknown> | undefined)?.[k], doc.effective()) !==
  undefined;

/** Removes the value at `path`: drops the overlay's own entry, and hides it when the template itself has one. */
function drop(doc: Doc, path: string): SettingsEdit {
  const dropped = run(doc, [{ kind: 'reset', path }]);
  if (!dropped.ok || !present(dropped.doc, path)) return dropped;
  return run(dropped.doc, [{ kind: 'hide', path }]);
}

/** Takes `tools.chat` and every role's entry for it out (a role may not list a tool the project does not declare). */
function switchOff(doc: Doc): SettingsEdit {
  let cur: SettingsEdit = { ok: true, doc };
  for (const key of Object.keys(rolesOf(doc.effective()))) {
    const path = `roles.${key}.app.tools.${CHAT}`;
    if (cur.ok && present(cur.doc, path)) cur = drop(cur.doc, path);
  }
  if (cur.ok && present(cur.doc, `tools.${CHAT}`)) cur = drop(cur.doc, `tools.${CHAT}`);
  return cur;
}

/** `app.tools` for a role that had every tool: the project's others, each active as it was. */
function listedWithout(file: TemplateFile): Record<string, Record<string, never>> {
  return Object.fromEntries(
    Object.keys(file.tools ?? {})
      .filter((k) => k !== CHAT)
      .map((k) => [k, {}]),
  );
}

/**
 * The chat on or off, and who has it: `roles` empty = every role ("Leer = alle"). Roles are given by key; one the file
 * does not have is refused. Other tools, and every other role's tools, stay as they are.
 */
export function setChat(
  doc: Doc,
  input: { readonly enabled: boolean; readonly roles: readonly string[] },
): SettingsEdit {
  if (!input.enabled) return switchOff(doc);
  const known = Object.keys(rolesOf(doc.effective()));
  if (input.roles.some((r) => !known.includes(r))) return { ok: false, code: 'invalid' };
  let cur: SettingsEdit = { ok: true, doc };
  if (doc.effective().tools?.[CHAT] === undefined)
    cur = run(doc, [
      { kind: 'unhide', path: `tools.${CHAT}` },
      { kind: 'set', path: `tools.${CHAT}`, value: {} },
    ]);
  if (!cur.ok) return cur;
  const file = cur.doc.effective();
  for (const [key, role] of Object.entries(rolesOf(file))) {
    if (!cur.ok) break;
    const want = input.roles.length === 0 || input.roles.includes(key);
    const now = toolAvailabilityFor(file, [key], CHAT) !== undefined;
    const entry = `roles.${key}.app.tools.${CHAT}`;
    if (want && !now)
      cur = run(cur.doc, [
        { kind: 'unhide', path: entry },
        { kind: 'set', path: entry, value: {} },
      ]);
    else if (!want && now)
      cur =
        role.app?.tools === undefined
          ? run(cur.doc, [{ kind: 'set', path: `roles.${key}.app.tools`, value: listedWithout(file) }])
          : drop(cur.doc, entry);
  }
  return cur;
}
