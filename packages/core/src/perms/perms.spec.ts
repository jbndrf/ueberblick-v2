import Database from 'better-sqlite3';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SQL_APP_FUNCTIONS } from '../expr/sql';
import { PERM_DENIALS } from '../registry';
import type { CompiledConfig } from '../schema/compile/contract';
import type { FeatureId, Key } from '../model';
import { visibleWhenMapping } from '../schema/compile/visible';
import { actorValue } from './actor';
import { PermsCompileError, compilePerms } from './index';
import type { PermSql, TypePerms } from './contract';
import { NOW, ROLES, actor, ctxFor, feature, world, worldResult } from './__fixtures__/world';

const config = world();
const perms = compilePerms(config);
const T = (t: string): TypePerms => {
  const p = perms.forType(t as Key);
  if (p === undefined) throw new Error(`no type ${t}`);
  return p;
};
const subj = (roles: readonly string[]) => perms.subjects(actor(roles));

describe('subjects', () => {
  it('maps roles to role:<key> subjects and nothing else', () => {
    expect(subj(['kontrolle', 'bauhof'])).toEqual(['role:kontrolle', 'role:bauhof']);
    expect(subj([])).toEqual([]);
  });
  it('unknown type gives undefined', () => {
    expect(perms.forType('nope' as Key)).toBeUndefined();
  });
});

describe('matrix: role x type x action; anything not allowed is denied', () => {
  const CREATE: Record<string, readonly string[]> = {
    baum: ['kontrolle'],
    flaeche: [],
    meldung: [...ROLES],
    geheim: [],
  };
  const DELETE: Record<string, readonly string[]> = {
    baum: ['verwaltung'],
    flaeche: [],
    meldung: ['kontrolle', 'verwaltung'],
    geheim: [],
  };
  const SEE_ROW: Record<string, readonly string[]> = {
    baum: [...ROLES],
    flaeche: [...ROLES],
    meldung: ['kontrolle'],
    geheim: [],
  };
  for (const type of Object.keys(CREATE))
    for (const role of ROLES) {
      it(`${role} on ${type}`, () => {
        const s = subj([role]);
        const c = T(type).canCreate(s);
        expect(c.ok).toBe((CREATE[type] as readonly string[]).includes(role));
        if (!c.ok) expect(c.denial).toBe('create_denied');
        const f = feature('f1', type, { stage: 'offen', zustaendig: 'u1' });
        const ctx = ctxFor(actor([role]), [f]);
        const d = T(type).canDelete(s, f, ctx);
        expect(d.ok).toBe(
          (DELETE[type] as readonly string[]).includes(role) &&
            (SEE_ROW[type] as readonly string[]).includes(role),
        );
        expect(T(type).canSee(s, f, ctx).ok).toBe((SEE_ROW[type] as readonly string[]).includes(role));
      });
    }
  it('an actor without roles is denied everything except $all audiences', () => {
    const s = subj([]);
    expect(T('baum').canCreate(s).ok).toBe(false);
    expect(T('geheim').canCreate(s).ok).toBe(false);
    expect(T('flaeche').canSee(s, feature('f', 'flaeche'), ctxFor(actor([]), [])).ok).toBe(true);
    expect(
      T('meldung').canSee(s, feature('f', 'meldung', { stage: 'offen' }), ctxFor(actor([]), [])).ok,
    ).toBe(false);
  });
  it('denials carry the registry code', () => {
    const d = T('flaeche').canCreate(subj(['kontrolle']));
    expect(d.ok === false && PERM_DENIALS.keys.includes(d.denial)).toBe(true);
    const f = feature('f', 'geheim');
    const n = T('geheim').canSee(subj(['kontrolle']), f, ctxFor(actor(['kontrolle']), [f]));
    expect(n).toEqual({ ok: false, denial: 'not_visible' });
    const w = T('flaeche').canDelete(
      subj(['kontrolle']),
      feature('f', 'flaeche'),
      ctxFor(actor(['kontrolle']), []),
    );
    expect(w).toEqual({ ok: false, denial: 'delete_denied' });
  });
});

describe('matrix: readable and writable are exact for every type x role (incl. no role)', () => {
  const PROPS: Record<string, readonly string[]> = {
    baum: ['stage', 'vitalitaet', 'intern_notiz', 'zustaendig', 'befund'],
    flaeche: ['name'],
    meldung: ['stage', 'titel'],
    frist: ['bis'],
    geheim: ['x'],
  };
  const BAUM_OPEN = ['stage', 'vitalitaet', 'zustaendig', 'befund'];
  const ACTORS: readonly (readonly string[])[] = [[], ...ROLES.map((r) => [r])];
  const READABLE: Record<string, Record<string, readonly string[]>> = {
    baum: { none: BAUM_OPEN, kontrolle: PROPS['baum'] as string[], bauhof: BAUM_OPEN, verwaltung: BAUM_OPEN },
    flaeche: { none: ['name'], kontrolle: ['name'], bauhof: ['name'], verwaltung: ['name'] },
    meldung: { none: [], kontrolle: ['stage', 'titel'], bauhof: [], verwaltung: [] },
    frist: { none: ['bis'], kontrolle: ['bis'], bauhof: ['bis'], verwaltung: ['bis'] },
    geheim: { none: [], kontrolle: [], bauhof: [], verwaltung: [] },
  };
  const WRITABLE: Record<string, Record<string, readonly string[]>> = {
    baum: { none: [], kontrolle: ['stage', 'vitalitaet'], bauhof: ['stage'], verwaltung: [] },
    flaeche: { none: [], kontrolle: [], bauhof: [], verwaltung: [] },
    meldung: { none: [], kontrolle: ['stage', 'titel'], bauhof: [], verwaltung: [] },
    frist: { none: [], kontrolle: [], bauhof: [], verwaltung: [] },
    geheim: { none: [], kontrolle: [], bauhof: [], verwaltung: [] },
  };
  for (const type of Object.keys(PROPS))
    for (const roles of ACTORS) {
      const who = roles[0] ?? 'none';
      it(`${who} on ${type}`, () => {
        const s = subj(roles);
        const tp = T(type);
        expect([...tp.readable(s)].sort()).toEqual([...(READABLE[type]?.[who] as string[])].sort());
        const w = (WRITABLE[type]?.[who] ?? []) as readonly string[];
        expect([...tp.writable(s)].sort()).toEqual([...w].sort());
        for (const p of [...(PROPS[type] as string[]), 'not_a_property'])
          expect(tp.canWrite(s, [p])).toEqual(
            w.includes(p) ? { ok: true } : { ok: false, denial: 'write_denied', property: p },
          );
      });
    }
});

describe('allowlists follow the see / write map semantics', () => {
  it('see map: listed only for the audience, unlisted visible to everyone who sees the feature', () => {
    const b = T('baum');
    expect([...b.readable(subj(['kontrolle']))].sort()).toEqual([
      'befund',
      'intern_notiz',
      'stage',
      'vitalitaet',
      'zustaendig',
    ]);
    expect([...b.readable(subj(['bauhof']))].sort()).toEqual(['befund', 'stage', 'vitalitaet', 'zustaendig']);
    expect([...b.readable(subj([]))].sort()).toEqual(['befund', 'stage', 'vitalitaet', 'zustaendig']);
  });
  it('whole-type see audience applies to every property; not in the audience reads nothing', () => {
    expect([...T('meldung').readable(subj(['kontrolle']))].sort()).toEqual(['stage', 'titel']);
    expect(T('meldung').readable(subj(['bauhof'])).size).toBe(0);
    expect([...T('flaeche').readable(subj([]))]).toEqual(['name']);
  });
  it('absent see reads nothing', () => {
    expect(T('geheim').readable(subj(['kontrolle'])).size).toBe(0);
  });
  it('write map: listed for the audience, unlisted denied, absent denied', () => {
    const b = T('baum');
    expect([...b.writable(subj(['kontrolle']))].sort()).toEqual(['stage', 'vitalitaet']);
    expect([...b.writable(subj(['bauhof']))]).toEqual(['stage']);
    expect(b.writable(subj(['verwaltung'])).size).toBe(0);
    expect(b.canWrite(subj(['bauhof']), ['stage'])).toEqual({ ok: true });
    expect(b.canWrite(subj(['bauhof']), ['stage', 'befund'])).toEqual({
      ok: false,
      denial: 'write_denied',
      property: 'befund',
    });
    expect(b.canWrite(subj(['kontrolle']), ['unknown_property'])).toEqual({
      ok: false,
      denial: 'write_denied',
      property: 'unknown_property',
    });
    expect(b.canWrite(subj([]), [])).toEqual({ ok: true });
  });
  it('write audience for the whole type covers every property', () => {
    expect([...T('meldung').writable(subj(['kontrolle']))].sort()).toEqual(['stage', 'titel']);
    expect(T('flaeche').writable(subj(['kontrolle'])).size).toBe(0);
    expect(T('geheim').canWrite(subj(['kontrolle']), ['x']).ok).toBe(false);
  });
});

describe('compilePerms refuses a declared visible_when whose expression is missing', () => {
  it('throws a typed error instead of dropping the restriction', () => {
    const expressions = new Map(config.expressions);
    for (const k of [...expressions.keys()]) if (k.includes('visible_when')) expressions.delete(k);
    expect(() => compilePerms({ ...config, expressions })).toThrow(PermsCompileError);
  });
});

describe('H2: subjects beyond roles', () => {
  it('a team subject in an audience works without touching the compiled paths', () => {
    const file = structuredClone(config.file) as unknown as {
      types: Record<string, { permissions: Record<string, unknown> }>;
    };
    (file.types['flaeche'] as { permissions: Record<string, unknown> }).permissions = {
      see: ['team:nord'],
      write: { name: ['team:nord', 'kontrolle'] },
    };
    const custom = compilePerms({ ...config, file: file as unknown as CompiledConfig['file'] });
    const f = custom.forType('flaeche' as Key) as TypePerms;
    const ctx = ctxFor(actor([]), []);
    const fx = feature('f', 'flaeche');
    expect(f.canSee(['team:nord'], fx, ctx).ok).toBe(true);
    expect(f.canSee(['role:nord'], fx, ctx).ok).toBe(false);
    expect(f.canSee(['team:sued'], fx, ctx).ok).toBe(false);
    expect([...f.writable(['team:nord'])]).toEqual(['name']);
    expect([...f.writable(['role:kontrolle'])]).toEqual(['name']);
    expect(f.seeSql(['team:nord'], actor([]), 'f', NOW)).toEqual({ kind: 'all' });
    expect(f.seeSql(['role:kontrolle'], actor([]), 'f', NOW)).toEqual({ kind: 'none' });
  });
});

describe('seeSql', () => {
  it('none / all / where', () => {
    expect(T('geheim').seeSql(subj(['kontrolle']), actor(['kontrolle']), 'f', NOW)).toEqual({ kind: 'none' });
    expect(T('flaeche').seeSql(subj([]), actor([]), 'f', NOW)).toEqual({ kind: 'all' });
    expect(T('meldung').seeSql(subj(['bauhof']), actor(['bauhof']), 'f', NOW)).toEqual({ kind: 'none' });
    expect(T('meldung').seeSql(subj(['kontrolle']), actor(['kontrolle']), 'f', NOW).kind).toBe('where');
  });
  it('is index-friendly: EXPLAIN uses the expression index on the property, not a scan', () => {
    const db = new Database(':memory:');
    db.exec(
      "CREATE TABLE features (id TEXT PRIMARY KEY, type TEXT NOT NULL, properties TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active')",
    );
    db.exec("CREATE INDEX f_stage ON features (type, json_extract(properties, '$.stage'))");
    const w = T('meldung').seeSql(subj(['kontrolle']), actor(['kontrolle']), 'f', NOW) as Extract<
      PermSql,
      { kind: 'where' }
    >;
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM features f WHERE f.type = ? AND ${w.sql}`)
      .all('meldung', ...w.params) as { detail: string }[];
    expect(plan.map((p) => p.detail).join('|')).toMatch(/USING (COVERING )?INDEX f_stage/);
  });
});

describe('one visible_when mapping (R1)', () => {
  it('seeSql builds its mapping with visibleWhenMapping, not a second construction', () => {
    const src = readFileSync(new URL('./compile.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/visibleWhenMapping\(/);
    expect(src).not.toMatch(/inverse:/);
  });
  it('an expression compile flags as visible_when_not_sql yields none, for anyone who may see the type', () => {
    const r = worldResult();
    const flagged = r.ok && r.warnings.some((p) => p.code === 'visible_when_not_sql');
    expect(flagged).toBe(true);
    expect(T('ort').seeSql(subj([]), actor([]), 'f', NOW)).toEqual({ kind: 'none' });
  });
});

describe('actor value and relation traversal', () => {
  it('SQL and in-memory sides bind the same actor value', () => {
    const a = actor(['kontrolle', 'bauhof'], 'u7');
    expect(visibleWhenMapping({ file: config.file }, a).vars.get('actor')).toEqual(actorValue(a));
  });
  it('a visible_when over an inverse relation: SQL agrees with canSee', () => {
    const db = new Database(':memory:');
    db.exec(
      "CREATE TABLE features (id TEXT PRIMARY KEY, type TEXT NOT NULL, properties TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active')",
    );
    db.exec('CREATE TABLE edges (from_id TEXT NOT NULL, relation TEXT NOT NULL, to_id TEXT NOT NULL)');
    const feats = [
      feature('b1', 'beet'),
      feature('b2', 'beet'),
      feature('b3', 'beet'),
      feature('z1', 'zaun', { stage: 'offen' }),
      feature('z2', 'zaun', { stage: 'zu' }),
    ];
    const edges: [string, string][] = [
      ['z1', 'b1'],
      ['z2', 'b2'],
    ];
    for (const f of feats)
      db.prepare('INSERT INTO features (id, type, properties) VALUES (?, ?, ?)').run(
        f.id,
        f.type,
        JSON.stringify(f.properties),
      );
    for (const [from, to] of edges)
      db.prepare("INSERT INTO edges (from_id, relation, to_id) VALUES (?, 'beet', ?)").run(from, to);
    const a = actor([]);
    const base = ctxFor(a, feats);
    const ctx = {
      ...base,
      relations: new Map([['beet' as Key, new Set(['zaeune' as Key])]]),
      features: {
        ...base.features,
        related: (id: string, rel: string) =>
          rel === 'zaeune' ? edges.filter(([, to]) => to === id).map(([from]) => from as FeatureId) : [],
      },
    } as typeof base;
    const tp = T('beet');
    const sql = tp.seeSql(subj([]), a, 'f', NOW);
    expect(sql.kind).toBe('where');
    if (sql.kind !== 'where') return;
    const seen: boolean[] = [];
    for (const f of feats.filter((x) => x.type === 'beet')) {
      const inSql =
        db
          .prepare(`SELECT 1 AS v FROM features f WHERE f.id = ? AND (${sql.sql})`)
          .get(f.id, ...sql.params) !== undefined;
      expect(inSql).toBe(tp.canSee(subj([]), f, ctx).ok);
      seen.push(inSql);
    }
    expect(seen).toEqual([true, false, false]);
  });
});

describe('property: SQL predicate and in-memory check agree (real SQLite)', () => {
  const db = new Database(':memory:');
  for (const f of SQL_APP_FUNCTIONS)
    db.function(f.name, { deterministic: true }, f.fn as (...a: unknown[]) => never);
  db.exec(
    "CREATE TABLE features (id TEXT PRIMARY KEY, type TEXT NOT NULL, properties TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active')",
  );
  const ids = ['u1', 'u2', 'u3'];
  const propArb = fc.record({
    zustaendig: fc.option(fc.constantFrom(...ids), { nil: undefined }),
    stage: fc.option(fc.constantFrom('offen', 'zu', 'x'), { nil: undefined }),
    bis: fc.option(
      fc.constantFrom('2026-01-01T00:00:00.000Z', '2026-09-29T12:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      { nil: undefined },
    ),
  });
  const typeArb = fc.constantFrom('baum', 'flaeche', 'meldung', 'frist', 'geheim');
  it('agrees on generated features, actors and roles', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(typeArb, propArb), { minLength: 1, maxLength: 8 }),
        fc.subarray([...ROLES]),
        fc.constantFrom(...ids),
        (rows, roles, uid) => {
          db.exec('DELETE FROM features');
          const feats = rows.map(([type, p], i) => {
            const props = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Record<
              string,
              string
            >;
            db.prepare('INSERT INTO features (id, type, properties) VALUES (?, ?, ?)').run(
              `f${i}`,
              type,
              JSON.stringify(props),
            );
            return feature(`f${i}`, type, props);
          });
          const a = actor(roles, uid);
          const s = perms.subjects(a);
          const ctx = ctxFor(a, feats);
          for (const f of feats) {
            const tp = T(f.type);
            const sql = tp.seeSql(s, a, 'f', NOW);
            const inSql =
              sql.kind === 'all'
                ? true
                : sql.kind === 'none'
                  ? false
                  : db
                      .prepare(`SELECT 1 AS v FROM features f WHERE f.id = ? AND (${sql.sql})`)
                      .get(f.id, ...sql.params) !== undefined;
            expect(inSql, `${f.type} ${JSON.stringify(f.properties)} roles=${roles} uid=${uid}`).toBe(
              tp.canSee(s, f, ctx).ok,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
