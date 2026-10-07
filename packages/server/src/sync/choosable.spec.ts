// WP-725: the participants a caller may choose for a participant property (`select.all`, v3 selectable-entities).
import { describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL_VERSION, choosableHash, type CompiledConfig } from '@ueberblick/core';
import { build } from '../store/run/testkit';
import { anna, scopedConfig, syncSetup, tree, vera, type SyncCtx } from './testkit';

const V = SYNC_PROTOCOL_VERSION;

/** The scoped golden config with `select.all` on the baum's `zustaendig`. */
function selecting(all: readonly string[] | undefined): CompiledConfig {
  const file = scopedConfig().file;
  const baum = file.types?.['baum'];
  const zustaendig = baum?.properties['zustaendig'];
  if (baum === undefined || zustaendig === undefined)
    throw new Error('golden template has no baum.zustaendig');
  // The template may declare `select` itself; the test builds the condition it names explicitly.
  const { select: _declared, ...bare } = zustaendig;
  void _declared;
  const properties = {
    ...baum.properties,
    zustaendig: { ...bare, ...(all === undefined ? {} : { select: { all: [...all] } }) },
  };
  return build({ ...file, types: { ...file.types, baum: { ...baum, properties } } });
}

function project(all: readonly string[] | undefined): SyncCtx {
  const ctx = syncSetup(selecting(all));
  const put = ctx.db.prepare('INSERT INTO participants (id, name, roles, disabled_at) VALUES (?, ?, ?, ?)');
  put.run('anna', 'Anna Aal', '[]', null);
  put.run('bernd', 'Bernd Bar', '[]', null);
  put.run('vera', 'Vera Vogt', '[]', null);
  put.run('gone', 'Gone Gast', '[]', '2026-01-01T00:00:00.000Z');
  put.run('nameless', null, '[]', null);
  return ctx;
}

const snap = (ctx: SyncCtx, actor: typeof vera, choosableHeld?: string) =>
  ctx.service.page(actor, {
    since: 0,
    scope: '',
    v: V,
    ...(choosableHeld === undefined ? {} : { choosable: choosableHeld }),
  });
const choosable = (page: ReturnType<typeof snap>) =>
  page.people.filter((p) => p.choosable === true).map(({ id, name }) => ({ id, name }));
const delta = (ctx: SyncCtx, actor: typeof vera, held: string | undefined, since = 0) => {
  const first = snap(ctx, actor);
  return ctx.service.page(actor, {
    since: since === 0 ? ctx.service.head() : since,
    scope: first.header.scopeFingerprint,
    v: V,
    ...(held === undefined ? {} : { choosable: held }),
  });
};

describe('choosable participants on the sync page', () => {
  it('ships every enabled participant by name to a role in select.all, never an email', () => {
    const page = snap(project(['verwaltung']), vera);
    expect(choosable(page)).toEqual([
      { id: 'anna', name: 'Anna Aal' },
      { id: 'bernd', name: 'Bernd Bar' },
      { id: 'nameless', name: '' },
      { id: 'vera', name: 'Vera Vogt' },
    ]);
    expect(page.header.choosable).toBe(choosableHash(choosable(page)));
    expect(JSON.stringify(page.people)).not.toContain('@');
  });

  it('ships nothing to a role outside select.all, and nothing when select is absent', () => {
    for (const page of [snap(project(['verwaltung']), anna), snap(project(undefined), vera)]) {
      expect(choosable(page)).toEqual([]);
      expect(page.header.choosable).toBeUndefined();
    }
  });

  it('sends no list when the device holds the current set: not on a delta, not on an empty one', () => {
    const ctx = project(['verwaltung']);
    ctx.seed([{ id: tree(1), type: 'baum', properties: { stage: 'erfasst' } }]);
    const held = snap(ctx, vera).header.choosable;
    const empty = delta(ctx, vera, held);
    expect(empty.people).toEqual([]);
    expect(empty.header.choosable).toBeUndefined();
    const changed = delta(ctx, vera, held, 1);
    expect(changed.people.filter((p) => p.choosable === true)).toEqual([]);
    expect(changed.header.choosable).toBeUndefined();
  });

  it('ships the full list, replacing the set, when a participant was added (even on an empty delta)', () => {
    const ctx = project(['verwaltung']);
    const held = snap(ctx, vera).header.choosable;
    ctx.db
      .prepare('INSERT INTO participants (id, name, roles, disabled_at) VALUES (?, ?, ?, ?)')
      .run('carla', 'Carla Cord', '[]', null);
    const page = delta(ctx, vera, held);
    expect(choosable(page).map((p) => p.id)).toEqual(['anna', 'bernd', 'carla', 'nameless', 'vera']);
    expect(page.header.choosable).toBe(choosableHash(choosable(page)));
  });

  it('ships the full list without a participant that was disabled, so the device drops it', () => {
    const ctx = project(['verwaltung']);
    const held = snap(ctx, vera).header.choosable;
    ctx.db
      .prepare("UPDATE participants SET disabled_at = '2026-02-02T00:00:00.000Z' WHERE id = 'bernd'")
      .run();
    const page = delta(ctx, vera, held);
    expect(choosable(page).map((p) => p.id)).toEqual(['anna', 'nameless', 'vera']);
    ctx.db.prepare("UPDATE participants SET disabled_at = '2026-02-02T00:00:00.000Z'").run();
    const none = delta(ctx, vera, page.header.choosable);
    expect(choosable(none)).toEqual([]);
    expect(none.header.choosable).toBe('');
  });

  it('a device that holds a set the caller may no longer have is told to drop it', () => {
    const page = delta(project(undefined), vera, 'stale-hash');
    expect(choosable(page)).toEqual([]);
    expect(page.header.choosable).toBe('');
  });

  it('keeps the scope fingerprint for participant changes, and changes it with the permission', () => {
    const ctx = project(['verwaltung']);
    const a = snap(ctx, vera).header.scopeFingerprint;
    ctx.db
      .prepare("UPDATE participants SET disabled_at = '2026-02-02T00:00:00.000Z' WHERE id = 'bernd'")
      .run();
    expect(snap(ctx, vera).header.scopeFingerprint).toBe(a);
    expect(snap(project(['kontrolle']), vera).header.scopeFingerprint).not.toBe(a);
  });

  it('stays small at 500 participants: one list of 500 names, only when it changed', () => {
    const ctx = project(['verwaltung']);
    const put = ctx.db.prepare('INSERT INTO participants (id, name, roles, disabled_at) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 500; i++) put.run(`p${i}`, `Person ${i}`, '[]', null);
    const first = snap(ctx, vera);
    expect(choosable(first)).toHaveLength(504);
    expect(JSON.stringify(first.people).length).toBeLessThan(40_000);
    // The time is measured in bench/server-sync/choosable (R14); here only the gate: an unchanged list is not re-sent.
    expect(delta(ctx, vera, first.header.choosable).header.choosable).toBeUndefined();
  });
});
