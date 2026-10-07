// WP-639: the creation quota is refused by the same core.plan on the server (the run store), and it counts what is
// stored: another participant is not affected, and a batch that would pass the quota is refused whole.
import { describe, expect, it } from 'vitest';
import type { Json, TemplateFile } from '@ueberblick/core';
import { actor, build, golden, setup, vera, type Ctx } from '../store/run/testkit';

const tree = (x: number): Record<string, Json> => ({
  vitalitaet: 'v2',
  geometrie: { type: 'Point', coordinates: [x, 50.735] },
});

function quotaSetup(quota: number): Ctx {
  const file = structuredClone(golden('musterstadt-plain').file) as TemplateFile;
  const role = file.roles?.['verwaltung'];
  if (!role) throw new Error('the golden project has no verwaltung role');
  role.quota = quota;
  return setup({ config: build(file) });
}

const create = (c: Ctx, who = vera, x = 7.1) => c.store.submit(c.run('erfassen', who, tree(x)));
const code = (r: ReturnType<typeof create>) => (r.outcome === 'refused' ? r.refusal.code : r.outcome);

describe('server quota', () => {
  it('refuses the create past the quota with quota_exceeded and stores nothing for it', () => {
    const c = quotaSetup(2);
    expect(code(create(c))).toBe('accepted');
    expect(code(create(c, vera, 7.101))).toBe('accepted');
    expect(code(create(c, vera, 7.102))).toBe('quota_exceeded');
    expect(c.store.facts.createdBy(vera.id, 10)).toBe(2);
  });

  it('counts per participant', () => {
    const c = quotaSetup(1);
    expect(code(create(c))).toBe('accepted');
    expect(code(create(c))).toBe('quota_exceeded');
    expect(code(create(c, actor('participant', 'vera2', ['verwaltung'])))).toBe('accepted');
  });

  it('a whole batch that would pass the quota is refused (atomic)', () => {
    const c = quotaSetup(1);
    const r = c.store.submitBatch([c.run('erfassen', vera, tree(7.1)), c.run('erfassen', vera, tree(7.101))]);
    expect(r.outcome).toBe('refused');
    expect(c.store.facts.createdBy(vera.id, 10)).toBe(0);
  });
});
