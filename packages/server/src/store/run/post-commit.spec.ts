/** WP-842: what runs after the commit (blob erasure, the run log) can fail without un-accepting the run. */
import { describe, expect, it } from 'vitest';
import { createStore } from '../index';
import { createDoorbell, withDoorbell, type DoorbellMessage } from '../../sync/doorbell';
import { createLogger, type Logger } from '../../log';
import { headSeq } from './testkit';
import { anna, setup } from './testkit';
import { expectDeclaredFieldsOnly, logSpy } from './log.testkit';
import { SHA, eraseRun, world } from './erasure.testkit';

const input = { geometrie: { type: 'Point', coordinates: [7.1, 50.7] }, vitalitaet: 'v2' };

/** A logger whose `run.committed` line throws (a full disk, a closed sink); every other line is kept. */
const flaky = (kept: string[]): Logger => {
  const real = createLogger({ sink: (l) => kept.push(l), now: () => 1 });
  return {
    log(event, fields) {
      if (event === 'run.committed') throw Object.assign(new Error('disk full: secret'), { code: 'ENOSPC' });
      real.log(event, fields);
    },
  };
};

describe('a failing post-commit hook', () => {
  it('still returns the accepted result and rings the bell; the failure is logged with declared fields only', () => {
    const ctx = setup();
    const kept: string[] = [];
    const bell = createDoorbell({ head: () => headSeq(ctx.db), pollMs: 0 });
    const heard: number[] = [];
    bell.subscribe((m: DoorbellMessage) => heard.push(m.to));
    const store = withDoorbell(createStore(ctx.db, { ...ctx.deps, log: flaky(kept) }), bell);
    const run = ctx.run('erfassen', anna, input);

    const result = store.submit(run);
    expect(result.outcome).toBe('accepted');
    expect(heard).toHaveLength(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE id = ?').get(run.id)).toMatchObject({ n: 1 });
    const lines = kept.map((l) => JSON.parse(l) as Record<string, string | number>);
    expect(lines).toMatchObject([{ event: 'run.hook_failed', hook: 'log', code: 'ENOSPC', level: 'error' }]);
    expect(kept.join('')).not.toContain('secret');
  });

  it('onOrphanedBlobs is called with the real orphan after the commit; a throwing one is logged hook=orphans and the run stays accepted', () => {
    // An erasure run orphans the blob of the erased photo (erasure.testkit world: mia reported once).
    const heard: (readonly string[])[] = [];
    const ok = world();
    const hearing = createStore(ok.c.db, { ...ok.c.deps, onOrphanedBlobs: (ids) => heard.push(ids) });
    expect(hearing.submit(eraseRun(ok.c)).outcome).toBe('accepted');
    expect(heard).toEqual([[SHA]]);

    const spy = logSpy();
    const bad = world();
    const store = createStore(bad.c.db, {
      ...bad.c.deps,
      log: spy.log,
      onOrphanedBlobs: () => {
        throw new TypeError('boom');
      },
    });
    const run = eraseRun(bad.c);
    expect(store.submit(run).outcome).toBe('accepted');
    expect(bad.c.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE id = ?').get(run.id)).toMatchObject({
      n: 1,
    });
    const failed = spy.only('run.hook_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ hook: 'orphans', code: 'TypeError' });
    expectDeclaredFieldsOnly(spy.lines());
  });
});
