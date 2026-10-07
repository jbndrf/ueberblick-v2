/** The bench project file must keep compiling with zero problems, else `npm run bench` breaks for a reason that is not speed. */
import { describe, expect, it } from 'vitest';
import { compile, NO_ASSETS } from '../../packages/core/src/schema/compile';
import { generate } from '../compile/generate';

describe('bench input: bench/compile generate', () => {
  it('produces a project file the compiler accepts with zero problems', () => {
    const r = compile(generate(), { assets: NO_ASSETS });
    expect(r.ok ? [] : r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
