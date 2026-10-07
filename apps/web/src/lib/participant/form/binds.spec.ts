// WP-795: a task's binds on the device come from core.plan (`bindsFor`); a missing bound Objekt gives a null variable.
import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { EvalContext } from '@ueberblick/core/expr';
import type { FeatureId, Instant, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { taskBinds } from './binds';

const config = goldenConfig('projects/musterstadt-bind-field.yaml');
const ctx = (area: readonly string[]): EvalContext => ({
  vars: new Map([['self', { $feature: 'b1' }]]) as never,
  features: {
    property: (id: FeatureId, key: string) => (id === 'f1' && key === 'name' ? 'Park' : undefined),
    related: () => area as never,
    history: () => [],
    type: (id: FeatureId) => (id === 'b1' ? 'baum' : 'flaeche') as Key,
  },
  now: '2026-10-04T00:00:00Z' as Instant,
  relations: new Map([['baum' as Key, new Set(['flaeche' as Key])]]),
  geo: createGeo(),
});

describe('taskBinds', () => {
  it('resolves the bind and offers label and properties of its Objektart', () => {
    const r = taskBinds(config, 'flaeche_pruefen', ctx(['f1']), new Map([['area', { $feature: 'f1' }]]));
    expect(r.ctx.vars.get('area')).toEqual({ $feature: 'f1' });
    expect(Object.keys(r.bound)).toEqual(['area']);
    expect(r.bound['area']?.properties['name']).toBeDefined();
  });
  it('a bind that yields no Objekt is a null variable, never an error; self stays', () => {
    const r = taskBinds(config, 'flaeche_pruefen', ctx([]), new Map([['area', null]]));
    expect(r.ctx.vars.get('area')).toBeNull();
    expect(r.ctx.vars.get('self')).toEqual({ $feature: 'b1' });
  });
  it('evaluates no expression itself: the resolved map is the only source of the bind variables (R1)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./binds.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/import[^;]*\bevaluate\b/);
    expect(src).not.toMatch(/expr\/evaluate|\bevaluate\(/);
  });
});
