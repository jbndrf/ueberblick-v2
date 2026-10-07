import { describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL_VERSION, type CompiledConfig, type Json, type SyncPage } from '@ueberblick/core';
import { build, headSeq, rid } from '../store/run/testkit';
import { anna, bernd, scopedConfig, syncSetup, tree, vera, type SyncCtx } from './testkit';

const V = SYNC_PROTOCOL_VERSION;

/** The scoped golden config with `activity_names` set per role (absent = default). */
function withNames(names: Readonly<Record<string, boolean | undefined>>): CompiledConfig {
  const file = scopedConfig().file;
  const roles = { ...file.roles };
  for (const [key, value] of Object.entries(names)) {
    const role = roles[key];
    if (role === undefined) throw new Error(`golden template has no role ${key}`);
    roles[key] = { ...role, app: { ...role.app, ...(value === undefined ? {} : { activity_names: value }) } };
  }
  return build({ ...file, roles });
}

let runN = 0;
/** One accepted run by `actor` that sets `values` on a feature: run row, observations, folded feature row. */
function act(
  ctx: SyncCtx,
  actor: string,
  id: string,
  values: Record<string, Json>,
  causedBy?: string,
): string {
  const runId = rid(700_000 + ++runN);
  const seq0 = headSeq(ctx.db);
  ctx.db
    .prepare(
      `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, client_time, received_at, outcome, caused_by, seq)
       VALUES (?, ?, 'participant', 'kontrolle', 1, '{}', '2026-05-01T07:59:00.000Z', '2026-05-01T08:00:00.000Z', 'accepted', ?, ?)`,
    )
    .run(runId, actor, causedBy ?? null, seq0 + 1);
  let seq = seq0;
  for (const [property, result] of Object.entries(values))
    ctx.db
      .prepare('INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (?, ?, ?, ?, ?)')
      .run(++seq, runId, id, property, JSON.stringify(result));
  const row = ctx.db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id);
  ctx.db
    .prepare('UPDATE features SET properties = ?, updated_seq = ? WHERE id = ?')
    .run(JSON.stringify({ ...JSON.parse(row?.properties ?? '{}'), ...values }), seq, id);
  return runId;
}

function project(names: Readonly<Record<string, boolean | undefined>> = {}): SyncCtx {
  const ctx = syncSetup(withNames(names));
  const put = ctx.db.prepare('INSERT INTO participants (id, name, roles) VALUES (?, ?, ?)');
  put.run('anna', 'Anna Aal', '[]');
  put.run('bernd', 'Bernd Bar', '[]');
  put.run('vera', 'Vera Vogt', '[]');
  ctx.seed([
    { id: tree(1), type: 'baum', properties: { zustaendig: 'anna', stage: 'erfasst', intern_notiz: 'x' } },
    { id: tree(2), type: 'baum', properties: { zustaendig: 'bernd', stage: 'erfasst' } },
  ]);
  return ctx;
}

const snap = (ctx: SyncCtx, who: typeof anna): SyncPage =>
  ctx.service.page(who, { since: 0, scope: '', v: V });
const runIdsOf = (p: SyncPage): string[] => p.runs.map((r) => r.id).sort();
const obsRunIds = (p: SyncPage): string[] => [...new Set(p.observations.map((o) => o.runId))].sort();

describe('runs on sync pages', () => {
  it('a snapshot carries exactly the runs of its observations, with task, times, seq and caused-by', () => {
    const ctx = project();
    const first = act(ctx, 'vera', tree(1), { stage: 'kontrolliert' });
    const second = act(ctx, 'anna', tree(1), { stage: 'gesperrt' }, first);
    const page = snap(ctx, vera);
    expect(runIdsOf(page)).toEqual(obsRunIds(page));
    expect(runIdsOf(page)).toContain(first);
    const run = page.runs.find((r) => r.id === second);
    expect(run).toMatchObject({
      task: 'kontrolle',
      actor: 'anna',
      clientTime: Date.parse('2026-05-01T07:59:00.000Z'),
      receivedAt: Date.parse('2026-05-01T08:00:00.000Z'),
      causedBy: first,
    });
    expect(run?.seq).toBeGreaterThan(0);
  });

  it('does not ship a run whose observations are all clipped (hidden feature or unreadable property)', () => {
    const ctx = project();
    const hiddenFeature = act(ctx, 'vera', tree(2), { stage: 'kontrolliert' }); // anna does not see tree 2
    const hiddenProperty = act(ctx, 'vera', tree(2), { intern_notiz: 'geheim' }); // bernd may not read it
    const forAnna = snap(ctx, anna);
    expect(runIdsOf(forAnna)).not.toContain(hiddenFeature);
    const forBernd = snap(ctx, bernd);
    expect(runIdsOf(forBernd)).toContain(hiddenFeature);
    expect(runIdsOf(forBernd)).not.toContain(hiddenProperty);
    expect(runIdsOf(forBernd)).toEqual(obsRunIds(forBernd));
  });

  it('a delta carries only the runs of the observations it resends', () => {
    const ctx = project();
    act(ctx, 'vera', tree(1), { stage: 'kontrolliert' });
    const cursor = ctx.service.head();
    const later = act(ctx, 'vera', tree(2), { stage: 'kontrolliert' });
    const first = snap(ctx, vera);
    const scope = first.header.scopeFingerprint;
    // the device already holds the choosable participants (WP-725), so they are not resent
    const choosable = first.header.choosable ?? '';
    const d = ctx.service.page(vera, { since: cursor, scope, v: V, choosable });
    expect(d.header.kind).toBe('delta');
    expect(runIdsOf(d)).toEqual(obsRunIds(d));
    expect(runIdsOf(d)).toContain(later);
    const none = ctx.service.page(vera, { since: ctx.service.head(), scope, v: V, choosable });
    expect(none.runs).toEqual([]);
    expect(none.people).toEqual([]);
  });
});

describe('activity_names', () => {
  it('false on the only role: no actor and no name for other people, own runs keep both', () => {
    const ctx = project({ kontrolle: false });
    const others = act(ctx, 'vera', tree(1), { stage: 'kontrolliert' });
    const own = act(ctx, 'anna', tree(1), { stage: 'gesperrt' });
    const page = snap(ctx, anna);
    expect(page.runs.find((r) => r.id === others)?.actor).toBeNull();
    expect(page.runs.find((r) => r.id === own)?.actor).toBe('anna');
    expect(page.people).toEqual([{ id: 'anna', name: 'Anna Aal' }]);
  });

  it('true or absent: actor and name are present', () => {
    for (const names of [{}, { kontrolle: true }]) {
      const ctx = project(names);
      const run = act(ctx, 'vera', tree(1), { stage: 'kontrolliert' });
      const page = snap(ctx, anna);
      expect(page.runs.find((r) => r.id === run)?.actor).toBe('vera');
      expect(page.people).toContainEqual({ id: 'vera', name: 'Vera Vogt' });
    }
  });

  it('a participant with several roles sees names when any role allows it', () => {
    const ctx = project({ kontrolle: false, bauhof: true });
    const run = act(ctx, 'vera', tree(1), { stage: 'kontrolliert' });
    const both = { ...anna, roles: ['kontrolle', 'bauhof'] as unknown as typeof anna.roles };
    expect(snap(ctx, both).runs.find((r) => r.id === run)?.actor).toBe('vera');
  });

  it('changing the setting changes the scope fingerprint', () => {
    const on = snap(project({ kontrolle: true }), anna).header.scopeFingerprint;
    const off = snap(project({ kontrolle: false }), anna).header.scopeFingerprint;
    expect(off).not.toBe(on);
    expect(snap(project({}), anna).header.scopeFingerprint).toBe(on);
    // another role's setting does not touch this actor's scope
    expect(snap(project({ bauhof: false }), anna).header.scopeFingerprint).toBe(on);
  });
});

describe('activity_names clips the creator of a feature (WP-762)', () => {
  const createdBy = (ctx: SyncCtx, actor: typeof anna, id: string): string | undefined =>
    snap(ctx, actor).features.find((f) => f.id === id)?.createdBy;
  const stamp = (ctx: SyncCtx, by: string): void => {
    ctx.db.prepare('UPDATE features SET created_by = ? WHERE id = ?').run(by, tree(1));
  };

  it("off: another person's feature carries no createdBy, the receiver's own keeps it", () => {
    const ctx = project({ kontrolle: false });
    stamp(ctx, 'vera');
    expect(createdBy(ctx, anna, tree(1))).toBeUndefined();
    expect(snap(ctx, anna).features.map((f) => f.id)).toContain(tree(1));
    stamp(ctx, 'anna');
    expect(createdBy(ctx, anna, tree(1))).toBe('anna');
  });

  it('on or absent: createdBy is sent', () => {
    const ctx = project({});
    stamp(ctx, 'vera');
    expect(createdBy(ctx, anna, tree(1))).toBe('vera');
  });
});
