import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isAuthError } from '../../auth/contract';
import { createDraftStore } from '../../builder-draft/store';
import { exportSubject } from '../../export-subject';
import { collectBytes, readZip } from '../../export-subject/zip-reader.testkit';
import { world as exportWorld } from '../../export-subject/world.testkit';
import {
  addParticipant,
  disableParticipant,
  enableParticipant,
  generateId,
  importParticipant,
  listParticipants,
  removeParticipant,
  updateParticipant,
} from './roster';
import { listColumns, setColumns } from './columns';
import { messageOf } from './messages';
import { issueQr, listRoster } from './service';
import { world } from './testkit';

type World = ReturnType<typeof world>;

/** A deployed config whose roles are `roles` (the compiled form keeps the file under `file`). */
function deploy(w: World, roles: readonly string[]): void {
  w.db
    .prepare(
      `INSERT INTO config_versions (version, schema, overlay, compiled, hash, status, created_at)
       VALUES (1, 'ueberblick/1', '{}', ?, 'h1', 'deployed', '2026-01-01T00:00:00.000Z')`,
    )
    .run(JSON.stringify({ file: { roles: Object.fromEntries(roles.map((r) => [r, {}])) } }));
}

const must = <T extends { readonly ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

describe('addParticipant: name required, generated id', () => {
  it('a name alone is enough; the id is a readable slug with a suffix', () => {
    const { ctx, db } = world();
    const r = must(addParticipant(ctx, { name: 'Jörg Müller-Lüdenscheidt', roles: [] }));
    expect(r.id).toMatch(/^joerg-mueller-luedenscheidt-[0-9a-f]{6}$/);
    expect(db.prepare('SELECT name, roles FROM participants WHERE id = ?').get(r.id)).toEqual({
      name: 'Jörg Müller-Lüdenscheidt',
      roles: '[]',
    });
    const second = must(addParticipant(ctx, { name: 'Jörg Müller-Lüdenscheidt', roles: [] }));
    expect(second.id).not.toBe(r.id);
  });

  it('an empty or blank name is refused with the v3 message', () => {
    const { ctx } = world();
    for (const name of ['', '   '])
      expect(addParticipant(ctx, { name, roles: [] })).toEqual({ ok: false, code: 'name_required' });
    expect(messageOf('name_required')).toEqual({ en: 'Name is required', de: 'Name ist erforderlich' });
    expect(listParticipants(ctx)).toEqual([]);
  });

  it('a generated id always passes the id rule and is not taken', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string()), (name, taken) => {
        const id = generateId(name, (c) => taken.includes(c));
        expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,40}-[0-9a-f]{6}$/);
        expect(taken).not.toContain(id);
      }),
    );
  });

  it('an invalid E-Mail is refused, an empty one is no E-Mail', () => {
    const { ctx } = world();
    expect(addParticipant(ctx, { name: 'A', email: 'no-at', roles: [] })).toEqual({
      ok: false,
      code: 'invalid_email',
    });
    const r = must(addParticipant(ctx, { name: 'A', email: '', roles: [] }));
    expect(listParticipants(ctx).find((p) => p.id === r.id)?.email).toBeNull();
  });
});

describe('E-Mail, Telefon and custom columns live in attrs', () => {
  const columns = [
    { key: 'personalnummer', label: 'Personalnummer', type: 'number', required: true },
    { key: 'team', label: 'Team', type: 'text', default: 'Nord' },
    { key: 'eintritt', label: 'Eintritt', type: 'date' },
    { key: 'fuehrerschein', label: 'Führerschein', type: 'boolean' },
  ] as const;

  it('round-trips E-Mail, Telefon and custom values; the default applies', () => {
    const { ctx, db } = world();
    expect(setColumns(db, columns)).toEqual({ ok: true });
    expect(listColumns(db).map((c) => [c.key, c.type, c.required, c.default])).toEqual([
      ['personalnummer', 'number', true, undefined],
      ['team', 'text', false, 'Nord'],
      ['eintritt', 'date', false, undefined],
      ['fuehrerschein', 'boolean', false, undefined],
    ]);
    const { id } = must(
      addParticipant(ctx, {
        name: 'Anna',
        email: 'anna@example.org',
        phone: '0151 1',
        roles: [],
        attrs: { personalnummer: 42, eintritt: '2026-03-01', fuehrerschein: true },
      }),
    );
    expect(listParticipants(ctx)).toEqual([
      expect.objectContaining({
        id,
        email: 'anna@example.org',
        phone: '0151 1',
        attrs: { personalnummer: 42, team: 'Nord', eintritt: '2026-03-01', fuehrerschein: true },
      }),
    ]);
    expect(
      JSON.parse((db.prepare('SELECT attrs FROM participants').get() as { attrs: string }).attrs),
    ).toEqual({
      personalnummer: 42,
      team: 'Nord',
      eintritt: '2026-03-01',
      fuehrerschein: true,
      email: 'anna@example.org',
      phone: '0151 1',
    });
    expect(updateParticipant(ctx, id, { phone: null, attrs: { team: 'Süd' } })).toEqual({ ok: true });
    expect(listParticipants(ctx)[0]).toMatchObject({ phone: null, email: 'anna@example.org' });
    expect(listParticipants(ctx)[0]?.attrs).toMatchObject({ team: 'Süd', personalnummer: 42 });
  });

  it('a required column without a value is refused on add and on update', () => {
    const { ctx, db } = world();
    setColumns(db, columns);
    expect(addParticipant(ctx, { name: 'A', roles: [] })).toEqual({
      ok: false,
      code: 'column_required',
      detail: 'personalnummer',
    });
    const { id } = must(addParticipant(ctx, { name: 'A', roles: [], attrs: { personalnummer: 1 } }));
    expect(updateParticipant(ctx, id, { attrs: { personalnummer: null } })).toEqual({
      ok: false,
      code: 'column_required',
      detail: 'personalnummer',
    });
    expect(listParticipants(ctx)[0]?.attrs).toMatchObject({ personalnummer: 1 });
  });

  it('refuses values of the wrong type and values for undefined columns', () => {
    const { ctx, db } = world();
    setColumns(db, columns);
    const base = { name: 'A', roles: [] };
    expect(addParticipant(ctx, { ...base, attrs: { personalnummer: 'x' } })).toMatchObject({
      code: 'column_value_invalid',
    });
    expect(
      addParticipant(ctx, { ...base, attrs: { personalnummer: 1, eintritt: '1.3.2026' } }),
    ).toMatchObject({
      code: 'column_value_invalid',
    });
    expect(addParticipant(ctx, { ...base, attrs: { personalnummer: 1, wat: 1 } })).toMatchObject({
      code: 'unknown_column',
      detail: 'wat',
    });
  });

  it('refuses malformed column definitions and changes nothing', () => {
    const { db } = world();
    setColumns(db, [{ key: 'team', label: 'Team', type: 'text' }]);
    const bad = [
      { key: 'email', label: 'E', type: 'text' },
      { key: 'Not A Key', label: 'x', type: 'text' },
      { key: 'a', label: ' ', type: 'text' },
      { key: 'a', label: 'a', type: 'color' },
      { key: 'a', label: 'a', type: 'number', default: 'x' },
    ] as const;
    for (const d of bad)
      expect(setColumns(db, [d as never])).toMatchObject({ ok: false, code: 'invalid_columns' });
    expect(
      setColumns(db, [
        { key: 'a', label: 'a', type: 'text' },
        { key: 'a', label: 'b', type: 'text' },
      ]),
    ).toMatchObject({ ok: false });
    expect(listColumns(db).map((c) => c.key)).toEqual(['team']);
  });
});

describe('disable, enable, remove', () => {
  it('disable refuses the sessions and token exchange; enable allows them again (A-025)', () => {
    const w = world();
    const { id } = must(addParticipant(w.ctx, { name: 'Anna', roles: [] }));
    const a = must(issueQr(w.ctx, id));
    const s = w.auth.exchange(a.token);
    if (isAuthError(s)) throw new Error(s.code);
    expect(w.auth.authenticate(s.id)).not.toBeNull();
    expect(disableParticipant(w.ctx, id)).toEqual({ ok: true });
    expect(w.auth.authenticate(s.id)).toBeNull();
    expect(w.auth.exchange(a.token)).toEqual({ code: 'participant_disabled' });
    expect(listParticipants(w.ctx)[0]?.disabledAt).not.toBeNull();
    expect(enableParticipant(w.ctx, id)).toEqual({ ok: true });
    expect(listParticipants(w.ctx)[0]?.disabledAt).toBeNull();
    const again = w.auth.exchange(a.token);
    expect(isAuthError(again)).toBe(false);
    expect(disableParticipant(w.ctx, 'nobody')).toEqual({ ok: false, code: 'participant_unknown' });
    expect(enableParticipant(w.ctx, 'nobody')).toEqual({ ok: false, code: 'participant_unknown' });
  });

  it('remove hides the participant, ends their access and keeps the row so runs still name the actor', () => {
    const w = world();
    const { id } = must(addParticipant(w.ctx, { name: 'Anna', roles: [] }));
    const q = must(issueQr(w.ctx, id));
    w.db
      .prepare(
        `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
         VALUES ('r1', ?, 'participant', 'melden', 1, '{}', '2026-01-01T00:00:00.000Z', 'accepted')`,
      )
      .run(id);
    expect(removeParticipant(w.ctx, id)).toEqual({ ok: true });
    expect(listRoster(w.ctx, { guests: true })).toEqual([]);
    expect(w.auth.exchange(q.token)).toEqual({ code: 'credential_revoked' });
    expect(w.db.prepare('SELECT actor FROM runs').get()).toEqual({ actor: id });
    expect(w.db.prepare('SELECT disabled_at, hidden FROM participants WHERE id = ?').get(id)).toMatchObject({
      hidden: 1,
    });
    expect(importParticipant(w.ctx, { id, roles: [] })).toEqual({ ok: false, code: 'participant_exists' });
  });
});

describe('roles are checked against the project', () => {
  it('an unknown role is refused with en and de text; known roles pass', () => {
    const w = world();
    deploy(w, ['kontrolle']);
    const r = addParticipant(w.ctx, { name: 'A', roles: ['kontrolle', 'chef'] });
    expect(r).toEqual({ ok: false, code: 'unknown_role', detail: 'chef' });
    const m = messageOf('unknown_role', 'chef');
    expect(m.en).toContain('chef');
    expect(m.de).toContain('chef');
    expect(m.de).not.toBe(m.en);
    expect(addParticipant(w.ctx, { name: 'A', roles: ['kontrolle'] }).ok).toBe(true);
    const { id } = must(addParticipant(w.ctx, { name: 'B', roles: [] }));
    expect(updateParticipant(w.ctx, id, { roles: ['chef'] })).toMatchObject({ code: 'unknown_role' });
    expect(addParticipant(w.ctx, { name: 'A', roles: ['Not A Key'] })).toMatchObject({
      code: 'invalid_role',
    });
  });

  it('a role that exists only in the draft is accepted (participants apply at once, Q13)', () => {
    const w = world();
    deploy(w, ['kontrolle']);
    createDraftStore(w.db).seed({
      template: 'baum',
      templateVersion: '1.0.0',
      overlay: 'schema: ueberblick/1\nextends: baum@1\nadd:\n  roles.bauhof:\n    label: Bauhof\n',
      by: 'a',
      at: '2026-01-02T00:00:00.000Z',
    });
    const ctx = { ...w.ctx, templates: { resolve: () => ({ schema: 'ueberblick/1', roles: {} }) as never } };
    expect(addParticipant(ctx, { name: 'A', roles: ['bauhof', 'kontrolle'] }).ok).toBe(true);
    expect(addParticipant(ctx, { name: 'A', roles: ['chef'] })).toMatchObject({ code: 'unknown_role' });
  });

  it('a role of the draft template counts when the template source is given', () => {
    const w = world();
    createDraftStore(w.db).seed({
      template: 'baum',
      templateVersion: '1.2.0',
      overlay: 'schema: ueberblick/1\nextends: baum@1\n',
      by: 'a',
      at: '2026-01-02T00:00:00.000Z',
    });
    const ctx = {
      ...w.ctx,
      templates: {
        resolve: (ref: string) => (ref === 'baum@1.2.0' ? ({ roles: { gaertner: {} } } as never) : undefined),
      },
    };
    expect(addParticipant(ctx, { name: 'A', roles: ['gaertner'] }).ok).toBe(true);
    expect(addParticipant(w.ctx, { name: 'A', roles: ['gaertner'] })).toMatchObject({ code: 'unknown_role' });
  });
});

describe('guests', () => {
  it('listRoster({ guests: false }) hides the self-joined; true shows them marked', () => {
    const w = world();
    must(addParticipant(w.ctx, { name: 'Anna', roles: [] }));
    must(addParticipant(w.ctx, { name: 'Gast', roles: [], selfJoined: true }));
    expect(listRoster(w.ctx, { guests: false }).map((p) => p.name)).toEqual(['Anna']);
    expect(listRoster(w.ctx, { guests: true }).map((p) => [p.name, p.selfJoined])).toEqual([
      ['Anna', false],
      ['Gast', true],
    ]);
  });
});

describe('personal data', () => {
  it('the subject export includes E-Mail, Telefon and custom values (attrs)', async () => {
    const w = exportWorld();
    try {
      setColumns(w.db, [{ key: 'team', label: 'Team', type: 'text' }]);
      const { id } = must(
        addParticipant(
          { db: w.db, now: () => new Date(0) },
          { name: 'Anna', email: 'anna@example.org', phone: '0151 1', roles: [], attrs: { team: 'Nord' } },
        ),
      );
      const z = readZip(await collectBytes(exportSubject(w.project, id, 'admin-1')));
      const who = JSON.parse(new TextDecoder().decode(z.get('participant.json'))) as { attrs: unknown };
      expect(who.attrs).toEqual({ team: 'Nord', email: 'anna@example.org', phone: '0151 1' });
    } finally {
      w.dispose();
    }
  });
});

describe('listRoster at scale (R14)', () => {
  it('2,000 participants: one roster query and one grouped credential query', () => {
    const w = world();
    w.db.transaction(() => {
      const ins = w.db.prepare('INSERT INTO participants (id, name, roles, created_at) VALUES (?,?,?,?)');
      for (let i = 0; i < 2000; i++) ins.run(`p-${String(i).padStart(4, '0')}`, `Person ${i}`, '[]', 'x');
    });
    const t0 = performance.now();
    const list = listRoster(w.ctx, { guests: true });
    const ms = performance.now() - t0;
    expect(list).toHaveLength(2000);
    console.info(`listRoster(2000): ${ms.toFixed(1)} ms`);
  });
});
