// WP-725: `select.all` / `select.self` of a participant property name roles the file declares.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TemplateFileSchema } from '../file';
import { compile, NO_ASSETS } from './index';

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = (): Record<string, unknown> => parse(Object.values(raw)[0] as string) as Record<string, unknown>;

function withSelect(select: unknown) {
  const file = base() as { types: Record<string, { properties: Record<string, unknown> }> };
  const baum = file.types['baum'];
  if (baum === undefined) throw new Error('no baum');
  baum.properties['zustaendig'] = { type: 'participant', select };
  return compile(TemplateFileSchema.parse(file), { assets: NO_ASSETS });
}

describe('participant select roles in compile', () => {
  it('accepts declared roles in all and self', () => {
    expect(withSelect({ all: ['kontrolle'], self: ['bauhof'] }).ok).toBe(true);
  });

  it('reports a typo in select.all with the path and the roles that exist', () => {
    const r = withSelect({ all: ['kontrolle', 'kontrole'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const p = r.problems.find((x) => x.code === 'select_unknown_role');
    expect(p?.path).toBe('types.baum.properties.zustaendig.select.all["1"]');
    expect(p?.params).toMatchObject({ role: 'kontrole', existing: 'kontrolle, bauhof' });
  });

  it('reports a typo in select.self', () => {
    const r = withSelect({ self: ['bauhoff'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((x) => x.code)).toContain('select_unknown_role');
  });
});
