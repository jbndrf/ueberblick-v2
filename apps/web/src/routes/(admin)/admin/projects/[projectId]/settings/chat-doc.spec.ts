import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { toolAvailabilityFor } from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { createRole } from '../roles/roles-doc';
import { chatView, setChat, type ChatEdit } from './chat-doc';

// WP-391: v3's ChatSection over lead-b's chat keys (`tools.chat`, `roles.<r>.app.tools.chat`), read through
// `toolAvailabilityFor` only. The golden project has three roles that list their tools; "gast" (added here) lists none.
const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
const must = (r: ChatEdit | { ok: boolean; doc?: Doc }): Doc => {
  if (!r.ok || r.doc === undefined) throw new Error(JSON.stringify(r));
  return r.doc;
};
const open = (): Doc => {
  const doc = openProject(
    golden('templates/maengelmelder/1.0.0.yaml'),
    golden('projects/stadtwerke-meldungen.yaml'),
  );
  return must(createRole(doc, { name: 'Gast' }));
};
const ROLES = ['melder', 'sachbearbeiter', 'handwerker', 'gast'];
const TOOLS = ['photo', 'search', 'measure', 'draw'];
const has = (doc: Doc, role: string, key: string) => toolAvailabilityFor(doc.effective(), [role], key);
const matrix = (doc: Doc, keys: readonly string[]) =>
  Object.fromEntries(ROLES.flatMap((r) => keys.map((k) => [`${r}/${k}`, has(doc, r, k)])));
const chatRoles = (doc: Doc) => ROLES.filter((r) => has(doc, r, 'chat') !== undefined);

describe('the switch adds and removes tools.chat in the draft', () => {
  it('is off when the project does not declare the chat tool', () => {
    expect(chatView(open().effective(), 'de').enabled).toBe(false);
  });
  it('on adds tools.chat; every role without its own tool list then has chat', () => {
    const doc = must(setChat(open(), { enabled: true, roles: [] }));
    expect(doc.dirty).toBe(true);
    expect(doc.effective().tools?.['chat']).toEqual({});
    expect(chatRoles(doc)).toEqual(ROLES); // "alle": the three that list tools get an entry
    expect(chatView(doc.effective(), 'de').enabled).toBe(true);
  });
  it('off removes tools.chat and every role entry for it (the file stays valid), and on again works', () => {
    let doc = must(setChat(open(), { enabled: true, roles: ['melder', 'gast'] }));
    doc = must(setChat(doc, { enabled: false, roles: [] }));
    expect(doc.effective().tools?.['chat']).toBeUndefined();
    expect(JSON.stringify(doc.effective().roles)).not.toContain('chat');
    expect(doc.problems().filter((p) => p.code.includes('reference'))).toEqual([]);
    doc = must(setChat(doc, { enabled: true, roles: ['sachbearbeiter'] }));
    expect(chatRoles(doc)).toEqual(['sachbearbeiter']);
  });
});

describe('who has chat (Leer = alle, restricted to roles)', () => {
  it('"alle" means every role has it, shown as an empty selection', () => {
    const doc = must(setChat(open(), { enabled: true, roles: [] }));
    expect(chatRoles(doc)).toEqual(ROLES);
    expect(chatView(doc.effective(), 'de')).toMatchObject({ enabled: true, all: true, roles: [] });
  });
  it('restricted to A and B: only they have chat, and no other tool changes for any role', () => {
    const before = matrix(open(), TOOLS);
    const doc = must(setChat(open(), { enabled: true, roles: ['melder', 'gast'] }));
    expect(chatRoles(doc)).toEqual(['melder', 'gast']);
    expect(matrix(doc, TOOLS)).toEqual(before);
    const view = chatView(doc.effective(), 'de');
    expect(view).toMatchObject({ enabled: true, all: false, roles: ['melder', 'gast'] });
    expect(view.options.map((o) => o.key)).toEqual(ROLES);
  });
  it("a role without a tool list that loses chat gets an explicit list of the project's other tools, all active", () => {
    const doc = must(setChat(open(), { enabled: true, roles: ['melder'] }));
    const gast = doc.effective().roles?.['gast']?.app?.tools;
    expect(Object.keys(gast ?? {}).sort()).toEqual([...TOOLS].sort());
    for (const k of TOOLS) expect(has(doc, 'gast', k)).toBe('active');
  });
  it('a listed tool with "offered" stays offered', () => {
    let doc = must(setChat(open(), { enabled: true, roles: ['melder', 'gast'] }));
    doc = doc.apply({
      kind: 'set',
      path: 'roles.melder.app.tools.photo',
      value: { availability: 'offered' },
    }).doc;
    doc = must(setChat(doc, { enabled: true, roles: ['gast'] }));
    expect(has(doc, 'melder', 'photo')).toBe('offered');
    expect(chatRoles(doc)).toEqual(['gast']);
  });
  it('clearing the selection restores "alle"', () => {
    let doc = must(setChat(open(), { enabled: true, roles: ['melder'] }));
    doc = must(setChat(doc, { enabled: true, roles: [] }));
    expect(chatRoles(doc)).toEqual(ROLES);
    expect(chatView(doc.effective(), 'de').all).toBe(true);
  });
  it('refuses a role the file does not have', () => {
    expect(setChat(open(), { enabled: true, roles: ['nobody'] })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });
  it('a chat entry is active (v3 had no offered/active choice)', () => {
    const doc = must(setChat(open(), { enabled: true, roles: ['melder'] }));
    expect(has(doc, 'melder', 'chat')).toBe('active');
  });
});

describe('property: for any selection, chat is exactly the selection and nothing else moves', () => {
  it('holds over every subset of roles', () => {
    const base = matrix(open(), TOOLS);
    fc.assert(
      fc.property(fc.subarray(ROLES), fc.subarray(ROLES), (first, second) => {
        let doc = must(setChat(open(), { enabled: true, roles: first }));
        doc = must(setChat(doc, { enabled: true, roles: second }));
        const want = second.length === 0 ? ROLES : ROLES.filter((r) => second.includes(r));
        expect(chatRoles(doc)).toEqual(want);
        expect(matrix(doc, TOOLS)).toEqual(base);
      }),
      { numRuns: 25 },
    );
  });
});
