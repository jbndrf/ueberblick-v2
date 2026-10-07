// WP-754: a replayed run id answers only the same actor with the same payload; anything else is id_taken, no observations.
import { describe, expect, it } from 'vitest';
import { seededIds } from '@ueberblick/core/plan';
import type { Json, Run } from '@ueberblick/core';
import { IDS, anna, bernd, seedMusterstadt, setup, type Ctx } from './testkit';

const kontrolle: Record<string, Json> = { vitalitaet: 'v3', befund: 'Pilzbefall' };

function annasRun(): { c: Ctx; run: Run } {
  const c = setup();
  seedMusterstadt(c);
  const run = c.run('kontrolle', anna, kontrolle, IDS.t_in);
  const first = c.store.submit(run);
  if (first.outcome !== 'accepted') throw new Error('setup: refused');
  return { c, run };
}
const count = (c: Ctx, t: string) => c.db.prepare<{ n: number }>(`SELECT count(*) AS n FROM ${t}`).get()?.n;

function expectTaken(r: ReturnType<Ctx['store']['submit']>): void {
  expect(r.outcome).toBe('refused');
  if (r.outcome !== 'refused') return;
  expect(r.refusal.code).toBe('id_taken');
  expect('observations' in r).toBe(false);
}

describe('a replayed run id is bound to its actor and payload (WP-754)', () => {
  it('H1: another actor replaying a run id is refused with id_taken and sees no observations', () => {
    const { c, run } = annasRun();
    const before = { obs: count(c, 'observations'), runs: count(c, 'runs') };
    expectTaken(c.store.submit({ ...run, actor: bernd, input: {} }));
    expect(count(c, 'observations')).toBe(before.obs);
    expect(count(c, 'runs')).toBe(before.runs);
  });

  it('H1b: another actor replaying a rule-run id is refused', () => {
    const { c, run } = annasRun();
    const ruleRun = seededIds(run.id).runId();
    expect(c.db.prepare('SELECT 1 FROM runs WHERE id = ?').get(ruleRun)).toBeDefined();
    expectTaken(c.store.submit({ ...run, id: ruleRun, actor: bernd }));
  });

  it('a submitted run cannot claim a rule-run id even as the same actor and payload', () => {
    const { c, run } = annasRun();
    expectTaken(c.store.submit({ ...run, id: seededIds(run.id).runId() }));
  });

  it('the same actor replaying with a changed payload is refused', () => {
    const { c, run } = annasRun();
    expectTaken(c.store.submit({ ...run, input: { ...kontrolle, befund: 'etwas anderes' } }));
    expectTaken(c.store.submit({ ...run, featureId: IDS.t_out, task: c.run('erfassen', anna).task }));
  });

  it('the same actor and payload still get the stored result (offline retry), also without a client time and with other key order', () => {
    const { c, run } = annasRun();
    const again = c.store.submit({ ...run, input: { befund: 'Pilzbefall', vitalitaet: 'v3' } });
    expect(again.outcome).toBe('accepted');
    const noTime = { ...run, clientTime: '2030-01-01T00:00:00.000Z' };
    expect(c.store.submit(noTime).outcome).toBe('accepted');
  });

  it("a batch whose second run reuses the first run's rule-run id is refused, nothing stored", () => {
    const c = setup();
    seedMusterstadt(c);
    const x = c.run('kontrolle', anna, kontrolle, IDS.t_in);
    const y = c.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'Neu' }, IDS.t_in, {
      id: seededIds(x.id).runId(),
    });
    const before = { obs: count(c, 'observations'), feats: count(c, 'features') };
    const r = c.store.submitBatch([x, y]);
    expect(r.outcome).toBe('refused');
    if (r.outcome === 'refused')
      expect(r.refusal, JSON.stringify(r.refusal)).toMatchObject({ code: 'id_taken' });
    expect(count(c, 'observations')).toBe(before.obs);
    expect(count(c, 'features')).toBe(before.feats);
    expect(
      c.db.prepare('SELECT 1 FROM runs WHERE id = ? AND outcome = ?').get(x.id, 'accepted'),
    ).toBeUndefined();
  });
});
