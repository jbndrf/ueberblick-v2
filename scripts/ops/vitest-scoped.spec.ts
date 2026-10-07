// WP-905: the vitest worker-cap decision (pure; no real load is read).
import { describe, expect, it } from 'vitest';
import { maxWorkersCap, repeatsNote, withWorkerCap } from './vitest-scoped.mjs';

describe('maxWorkersCap', () => {
  it('keeps the default at or below one runnable task per core', () => {
    expect(maxWorkersCap({ load: 10, nproc: 64 })).toBeNull();
    expect(maxWorkersCap({ load: 64, nproc: 64 })).toBeNull();
  });
  it('caps to nproc/4 above that, never below 1', () => {
    expect(maxWorkersCap({ load: 219, nproc: 64 })).toBe(16);
    expect(maxWorkersCap({ load: 9, nproc: 2 })).toBe(1);
  });
});

describe('withWorkerCap', () => {
  it('prints one line and adds the flag under overload', () => {
    const said: string[] = [];
    const out = withWorkerCap(['run', 'a.spec.ts'], { load: 219, nproc: 64 }, (m) => said.push(m));
    expect(out).toEqual(['run', 'a.spec.ts', '--maxWorkers=16']);
    expect(said).toHaveLength(1);
  });
  it('leaves args alone at normal load, for non-run commands and when the caller set it', () => {
    const say = () => {
      throw new Error('must not print');
    };
    expect(withWorkerCap(['run', 'x'], { load: 3, nproc: 64 }, say)).toEqual(['run', 'x']);
    expect(withWorkerCap(['watch'], { load: 300, nproc: 64 }, say)).toEqual(['watch']);
    expect(withWorkerCap(['run', '--maxWorkers=2'], { load: 300, nproc: 64 }, say)).toEqual([
      'run',
      '--maxWorkers=2',
    ]);
  });
});

describe('repeatsNote', () => {
  it('names the real execution count for --repeats N and --repeats=N', () => {
    expect(repeatsNote(['run', 'a.spec.ts', '--repeats', '4'])).toMatch(/runs 5 times/);
    expect(repeatsNote(['run', '--repeats=2'])).toMatch(/runs 3 times/);
  });
  it('says nothing without --repeats or with a bad value', () => {
    expect(repeatsNote(['run', 'a.spec.ts'])).toBeNull();
    expect(repeatsNote(['run', '--repeats', 'x'])).toBeNull();
  });
});
