/** WP-756: the real store refuses a participant value that is no member of the project, whoever forgot to check. */
import { describe, expect, it } from 'vitest';
import { eraseRun, sabine, world } from './erasure.testkit';

describe('the run store checks membership of a chosen participant', () => {
  it('a select.all role choosing a non-member is refused not_permitted; a member passes', () => {
    const { c } = world();
    const refused = c.store.submit(eraseRun(c, 'ghost', sabine));
    expect(refused.outcome).toBe('refused');
    if (refused.outcome === 'refused') expect(refused.refusal.code).toBe('not_permitted');
    expect(c.store.submit(eraseRun(c, 'mia', sabine)).outcome).toBe('accepted');
  });
  it('a disabled participant is no member', () => {
    const { c } = world();
    c.db.prepare("UPDATE participants SET disabled_at = 'x' WHERE id = 'mia'").run();
    const r = c.store.submit(eraseRun(c, 'mia', sabine));
    expect(r.outcome).toBe('refused');
  });
});
