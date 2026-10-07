/** Invariants of the conversion: no widening of v3 write roles, and quantifiers over many-valued relations. */
import { describe, expect, it } from 'vitest';
import { convertConfig } from './convert';
import { FIXTURES, loadFixture } from './testing';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every field record of a v3 export (`{ key, record }` items with a `field_type`), by workflow key. */
function fieldRecords(
  node: unknown,
  out: { key: string; record: Rec }[] = [],
): { key: string; record: Rec }[] {
  if (Array.isArray(node)) for (const n of node) fieldRecords(n, out);
  else if (isRec(node)) {
    if (typeof node['key'] === 'string' && isRec(node['record']) && 'field_type' in node['record']) {
      out.push({ key: node['key'], record: node['record'] });
    }
    for (const v of Object.values(node)) fieldRecords(v, out);
  }
  return out;
}

describe.each(FIXTURES)('write roles of %s', (name) => {
  const v3 = loadFixture(name);
  const result = convertConfig(v3);
  const roleOf = (v3Role: string): string | undefined => result.mapping.roles[v3Role.replace(/^@role\//, '')];

  it('are never wider than v3, plus only the roles of the tasks that compute the field', () => {
    const v3Write = new Map<string, string[] | undefined>();
    for (const { key, record } of fieldRecords(v3)) {
      const roles = record['write_roles'];
      v3Write.set(
        key,
        Array.isArray(roles)
          ? roles.map((r) => roleOf(String(r))).filter((r): r is string => r !== undefined)
          : undefined,
      );
    }
    const computeRoles = new Set(
      Object.values(result.template.tasks ?? {}).flatMap((t) => {
        const m = /'([a-z0-9_]+)' in actor\.roles/g;
        return [...(t.when ?? '').matchAll(m)].map((x) => x[1] as string);
      }),
    );
    let checked = 0;
    for (const t of [...Object.values(result.mapping.types), ...Object.values(result.mapping.tables)]) {
      const write = result.template.types?.[t.type]?.permissions?.write;
      if (typeof write !== 'object' || Array.isArray(write)) continue;
      for (const [v3Key, p] of Object.entries(t.properties)) {
        const allowed = v3Write.get(v3Key);
        const v4 = write[p.property];
        if (allowed === undefined || v4 === undefined) continue; // unrestricted in v3: nothing to widen
        expect(v4, `${t.type}.${p.property}`).not.toBe('$all');
        const extra = (v4 as string[]).filter((r) => !allowed.includes(r) && !computeRoles.has(r));
        expect(extra, `${t.type}.${p.property}`).toEqual([]);
        checked++;
      }
    }
    if (name === 'baumkontrolle') expect(checked).toBeGreaterThan(0);
  });
});

describe('quantifiers over a many-valued relation', () => {
  const when = (quantifier: string): string => {
    const v3 = structuredClone(loadFixture('baumkontrolle'));
    const cond = {
      kind: 'related',
      via: '@field/kinder',
      quantifier,
      condition: { kind: 'instance_status', status: 'archived' },
    };
    let injected = false;
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) {
        if (!injected && n.some((c) => isRec(c) && c['via'] === '@field/flaeche_ref')) {
          n.push(cond);
          injected = true;
        }
        n.forEach(walk);
      } else if (isRec(n)) Object.values(n).forEach(walk);
    };
    walk(v3);
    expect(injected).toBe(true);
    const r = convertConfig(v3);
    expect(r.check.problems).toEqual([]);
    return Object.values(r.template.tasks ?? {})
      .map((t) => t.when ?? '')
      .filter((w) => w.includes('kinder'))
      .join(' | ');
  };

  it('any is exists over the list', () => {
    expect(when('any')).toMatch(/(?<!!)self\.kinder\.exists\(r1, /);
  });
  it('all is all over the list', () => {
    expect(when('all')).toMatch(/self\.kinder\.all\(r1, /);
  });
  it('none is not exists over the list', () => {
    expect(when('none')).toMatch(/!self\.kinder\.exists\(r1, /);
  });
});
