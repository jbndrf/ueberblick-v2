/** WP-860 (WP-841 follow-up): a hook that throws inside the run transaction rolls the run back with a named, defined error. */
import { describe, expect, it } from 'vitest';
import { HookFailed, type TransactionHook } from './contract';
import { errorKind } from './transaction';
import { anna, setup } from './testkit';

const input = { geometrie: { type: 'Point', coordinates: [7.1, 50.7] }, vitalitaet: 'v2' };
const named = (hookName: string, fn: TransactionHook): TransactionHook => Object.assign(fn, { hookName });
const runs = (c: ReturnType<typeof setup>): unknown => c.db.prepare('SELECT COUNT(*) AS n FROM runs').get();

describe('a hook that throws inside the run transaction', () => {
  it('rolls the run back and surfaces HookFailed with code hook_<name>; the cause is kept', () => {
    const cause = new TypeError('timers table gone');
    const ctx = setup({
      hooks: [
        named('timers', () => {
          throw cause;
        }),
      ],
    });
    let thrown: unknown;
    try {
      ctx.store.submit(ctx.run('erfassen', anna, input));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HookFailed);
    expect(errorKind(thrown)).toBe('hook_timers');
    expect((thrown as HookFailed).cause).toBe(cause);
    expect(runs(ctx)).toEqual({ n: 0 });
  });

  it('a transient SQLITE_BUSY inside the hook is passed through unchanged (the intake answers 503)', () => {
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    const ctx = setup({
      hooks: [
        named('timers', () => {
          throw busy;
        }),
      ],
    });
    expect(() => ctx.store.submit(ctx.run('erfassen', anna, input))).toThrow(busy);
    expect(runs(ctx)).toEqual({ n: 0 });
  });
});
