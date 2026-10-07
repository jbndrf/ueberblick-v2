// WP-163: run.committed / run.refused are emitted once per submitted run, with declared fields only.
import { describe, expect, it } from 'vitest';
import { expectDeclaredFieldsOnly } from './log.testkit';
import { IDS, anna, seedMusterstadt, setup, vera } from './testkit';

const SECRET = 'Anna Muster 0151-secret-befund';
const kontrolle = (befund: string) => ({ vitalitaet: 'v2', befund });
const tree = (x: number, y: number) => ({
  vitalitaet: 'v2',
  geometrie: { type: 'Point', coordinates: [x, y] },
});

describe('run log events', () => {
  it('an accepted run logs run.committed once, with its observation count', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, kontrolle(SECRET), IDS.t_in);
    const r = c.store.submit(run);
    expect(r.outcome).toBe('accepted');
    const [line, ...rest] = c.logs.only('run.committed');
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ runId: run.id, actor: 'anna', level: 'info' });
    expect(line?.['observations']).toBe(r.outcome === 'accepted' ? r.observations.length : -1);
    expect(typeof line?.['ms']).toBe('number');
    expect(c.logs.only('run.refused')).toEqual([]);
    expectDeclaredFieldsOnly(c.logs.lines());
    expect(JSON.stringify(c.logs.lines())).not.toContain(SECRET);
  });

  it('a refused run logs run.refused with the refusal code and no message', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'unauffällig' }, IDS.t_in);
    const r = c.store.submit(run);
    expect(r.outcome).toBe('refused');
    const lines = c.logs.only('run.refused');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      runId: run.id,
      actor: 'anna',
      code: r.outcome === 'refused' ? r.refusal.code : '',
    });
    expect(c.logs.only('run.committed')).toEqual([]);
    expectDeclaredFieldsOnly(c.logs.lines());
    expect(JSON.stringify(c.logs.lines())).not.toContain('Befund muss sich');
  });

  it('a replay logs nothing again', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, kontrolle('Erstbefund'), IDS.t_in);
    c.store.submit(run);
    const n = c.logs.lines().length;
    c.store.submit(run);
    expect(c.logs.lines()).toHaveLength(n);
  });

  it('a batch logs one run.committed per submitted run', () => {
    const c = setup();
    seedMusterstadt(c);
    const runs = [1, 2, 3].map((i) => c.run('erfassen', vera, tree(10 + i / 1000, 50 + i / 1000)));
    expect(c.store.submitBatch(runs).outcome).toBe('accepted');
    const lines = c.logs.only('run.committed');
    expect(lines.map((l) => l['runId'])).toEqual(runs.map((r) => r.id));
    expectDeclaredFieldsOnly(c.logs.lines());
  });

  it('a refused batch logs the failing run with its code and the others as batch_failed', () => {
    const c = setup();
    seedMusterstadt(c);
    const good = c.run('kontrolle', anna, kontrolle('Ok neu'), IDS.t_in);
    const bad = c.run('kein_task', anna, {}, IDS.t_in);
    const r = c.store.submitBatch([good, bad]);
    expect(r.outcome).toBe('refused');
    const lines = c.logs.only('run.refused');
    expect(lines).toHaveLength(2);
    const byRun = new Map(lines.map((l) => [l['runId'], l['code']]));
    expect(byRun.get(good.id)).toBe('batch_failed');
    expect(byRun.get(bad.id)).toBe(r.outcome === 'refused' ? r.refusal.code : '');
    expect(c.logs.only('run.committed')).toEqual([]);
    expectDeclaredFieldsOnly(c.logs.lines());
  });

  it('a malformed batch (run id twice) logs only the malformed run', () => {
    const c = setup();
    seedMusterstadt(c);
    const a = c.run('kontrolle', anna, kontrolle('A1'), IDS.t_in);
    const r = c.store.submitBatch([a, a]);
    expect(r.outcome).toBe('refused');
    const lines = c.logs.only('run.refused');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ runId: a.id, code: 'invalid_input' });
  });
});
