import { describe, expect, it, vi } from 'vitest';
import type { FeatureState, Key } from '@ueberblick/core/model';
import type { FilterEnv } from '@ueberblick/core/filters';

const applyFilter = vi.fn((_env: unknown, _f: unknown, type: string, fs: FeatureState[]) =>
  type === 'baum' ? fs : [],
);
const compileFilter = vi.fn((_c: unknown, filters: Record<string, string>) =>
  filters['bad'] === undefined
    ? { ok: true as const, filter: { predicates: new Map() } }
    : { ok: false as const, problems: [] },
);
vi.mock('@ueberblick/core/filters', () => ({ applyFilter, compileFilter }));

const { viewPass, deviceViewPassOf } = await import('./view-pass');
const env = { config: {} } as unknown as FilterEnv;
const st = (type: string) => ({ id: '1', type: type as Key }) as unknown as FeatureState;

describe('viewPass', () => {
  it('compiles once and asks the engine per feature, so permissions clip the view', () => {
    compileFilter.mockClear();
    const pass = viewPass(env, { baum: "self.stage == 'erfasst'" });
    expect(pass?.(st('baum'))).toBe(true);
    expect(pass?.(st('flaeche'))).toBe(false);
    expect(compileFilter).toHaveBeenCalledTimes(1);
  });
  it('a filter that does not compile gives no view', () => {
    expect(viewPass(env, { bad: 'x' })).toBeUndefined();
  });
  it('while the Ansichten tool is off no view applies (v3 isFeatureEnabled), on again it does', () => {
    const device = {
      config: { file: { roles: {} } },
      actor: { id: 'u', kind: 'participant', roles: [] },
      roleKey: undefined,
      reader: { taskContext: () => ({}) },
    } as never;
    let on = false;
    const saved = [{ id: 's', name: 'S', filters: { baum: 'true' } }];
    const of = deviceViewPassOf(
      device,
      () => saved,
      () => on,
    );
    expect(of({ kind: 'saved', key: 's' })).toBeUndefined();
    on = true;
    expect(of({ kind: 'saved', key: 's' })?.(st('baum'))).toBe(true);
  });
  it('a role preset applies with the Ansichten tool off (Q20, WP-808), a saved view does not', () => {
    const device = {
      config: {
        file: { roles: { r: { app: { filter_presets: { p: { label: 'P', filters: { baum: 'true' } } } } } } },
      },
      actor: { id: 'u', kind: 'participant', roles: [] },
      roleKey: 'r',
      reader: { taskContext: () => ({}) },
    } as never;
    const saved = [{ id: 's', name: 'S', filters: { baum: 'true' } }];
    const of = deviceViewPassOf(
      device,
      () => saved,
      () => false,
    );
    expect(of({ kind: 'preset', key: 'p' })?.(st('baum'))).toBe(true);
    expect(of({ kind: 'saved', key: 's' })).toBeUndefined();
  });
});
