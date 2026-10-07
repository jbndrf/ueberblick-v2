/**
 * Evaluation corpus (docs/06 "Parity"): the world below plus [source, expected value] cases.
 * Every source is parsed, checked against `ENV` (check-cases.ts) and evaluated with `evalContext()`.
 * Add a case here before you add a feature.
 */
import type { FeatureId, Instant, Json, Key, RecordedObservation, RunId } from '../../model';
import { createGeo } from '../../geo';
import type { EvalContext, EvalValue, FeatureAccess } from '../contract';
import { EVAL_HOURS_MATCHES } from './eval-cases-hours-matches';

export { ENV } from './check-cases';

/** The injected time of every case. */
export const NOW: Instant = '2026-09-29T12:34:56.000Z';

const id = (s: string) => s as FeatureId;
const key = (s: string) => s as Key;

const square = (x: number, y: number, d: number): Json => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + d, y],
      [x + d, y + d],
      [x, y + d],
      [x, y],
    ],
  ],
});
const point = (x: number, y: number): Json => ({ type: 'Point', coordinates: [x, y] });

interface World {
  readonly type: string;
  readonly properties: Readonly<Record<string, Json>>;
  readonly relations: Readonly<Record<string, readonly string[]>>;
}

const WORLD: Readonly<Record<string, World>> = {
  b1: {
    type: 'baum',
    properties: {
      stage: 'aktiv',
      hoehe: 12.5,
      art: 'Linde',
      alter: 40,
      geom: point(9.5, 52),
      tags: ['a', 'b'],
      pruefung: '2026-01-01T00:00:00.000Z',
      meta: { x: 1, name: 'meta' },
    },
    relations: { flaeche: ['f1'], kontrollen: ['k1', 'k2'] },
  },
  b2: {
    type: 'baum',
    properties: { stage: 'erledigt', hoehe: 3, art: 'Eiche', alter: 5, geom: point(20, 30), tags: [] },
    relations: { flaeche: [], kontrollen: [] },
  },
  f1: {
    type: 'flaeche',
    properties: { name: 'Park', geom: square(9, 51.5, 1) },
    relations: { baeume: ['b1'] },
  },
  k1: {
    type: 'kontrolle',
    properties: { ok: true, datum: '2026-02-01T00:00:00.000Z', note: 'gut' },
    relations: {},
  },
  k2: {
    type: 'kontrolle',
    properties: { ok: false, datum: '2026-03-01T00:00:00.000Z' },
    relations: {},
  },
};

const observation = (feature: string, property: string, result: Json, seq: number): RecordedObservation => ({
  featureId: id(feature),
  property,
  result,
  seq,
  runId: 'r1' as RunId,
  // the run's time: one day per seq, so a case can say which observation a time comes from
  phenomenonTime: `2026-02-${String(seq).padStart(2, '0')}T10:00:00.000Z`,
});

/** Newest first, as `FeatureAccess.history` returns them. */
const HISTORY: Readonly<Record<string, readonly RecordedObservation[]>> = {
  'b1/stage': [observation('b1', 'stage', 'aktiv', 3), observation('b1', 'stage', 'neu', 1)],
  'b1/hoehe': [
    observation('b1', 'hoehe', 12.5, 6),
    observation('b1', 'hoehe', 11, 5),
    observation('b1', 'hoehe', 10, 4),
  ],
  'b1/art': [observation('b1', 'art', 'Linde', 2)],
  'b2/stage': [observation('b2', 'stage', 'erledigt', 2), observation('b2', 'stage', 'erledigt', 1)],
};

export const features: FeatureAccess = {
  property: (f, k) => WORLD[f]?.properties[k],
  related: (f, r) => (WORLD[f]?.relations[r] ?? []).map(id),
  history: (f, p, limit) => (HISTORY[`${f}/${p}`] ?? []).slice(0, limit),
  type: (f) => (WORLD[f] ? key(WORLD[f].type) : undefined),
};

const ref = (f: string): EvalValue => ({ $feature: id(f) });

export function evalContext(overrides: Readonly<Record<string, EvalValue>> = {}): EvalContext {
  const vars = new Map<string, EvalValue>([
    ['self', ref('b1')],
    ['area', ref('f1')],
    ['other', ref('b2')],
    ['form', { hoehe: 4.5, art: 'Eiche', anzahl: 3 }],
    ['actor', { id: 'u1', roles: ['inspector', 'viewer'], kind: 'human' }],
    ['inputs', { limit: 10, name: 'x' }],
    ['value', 2.5],
  ]);
  for (const [k, v] of Object.entries(overrides)) vars.set(k, v);
  return {
    vars,
    features,
    now: NOW,
    geo: createGeo(),
    relations: new Map([
      [key('baum'), new Set([key('flaeche'), key('kontrollen')])],
      [key('flaeche'), new Set([key('baeume')])],
    ]),
  };
}

/** [source, expected] — a value. */
export type EvalCase = readonly [string, Json];
const TODAY = '2026-09-29T00:00:00.000Z';

export const EVAL_OK: readonly EvalCase[] = [
  ...EVAL_HOURS_MATCHES,
  // literals and containers
  ['true', true],
  ['null', null],
  ['42', 42],
  ["'abc'", 'abc'],
  ['[1, 2, 3]', [1, 2, 3]],
  ["{'a': 1, 'b': [true]}", { a: 1, b: [true] }],
  // arithmetic
  ['1 + 2', 3],
  ['7 - 10', -3],
  ['6 * 7', 42],
  ['7 / 2', 3],
  ['-7 / 2', -3],
  ['7.0 / 2', 3.5],
  ['7 % 3', 1],
  ['-7 % 3', -1],
  ['1 + 2.5', 3.5],
  ['-(3)', -3],
  ['-self.hoehe', -12.5],
  ["'a' + 'b'", 'ab'],
  ['[1] + [2, 3]', [1, 2, 3]],
  ['self.alter + 2', 42],
  ['self.hoehe * 2', 25],
  ['2 * 3 + 4 * 5', 26],
  // comparison
  ['1 == 1.0', true],
  ['1 != 2', true],
  ["'a' < 'b'", true],
  ['2 <= 2', true],
  ['3 > 2.5', true],
  ['3 >= 4', false],
  ['[1, [2]] == [1, [2]]', true],
  ["{'a': 1} == {'a': 1}", true],
  ["{'a': 1} == {'a': 2}", false],
  ['null == null', true],
  ['null == 1', false],
  ["self.stage == 'aktiv'", true],
  ["self.stage != 'aktiv'", false],
  ['self == self', true],
  ['self == other', false],
  ['self.flaeche == area', true],
  // logic
  ['true && false', false],
  ['true || false', true],
  ['!true', false],
  ['false && self.meta.gone.foo > 1', false],
  ['true || self.meta.gone.foo > 1', true],
  ["self.stage == 'aktiv' && self.hoehe > 10", true],
  ["self.stage == 'x' || self.hoehe > 100", false],
  ['true ? 1 : 2', 1],
  ['false ? 1 : 2', 2],
  ["self.stage == 'aktiv' ? 'ja' : 'nein'", 'ja'],
  ['1 in [1, 2]', true],
  ['3 in [1, 2]', false],
  ["'x' in {'x': 1}", true],
  ["'y' in {'x': 1}", false],
  ["'a' in self.tags", true],
  ["'z' in self.tags", false],
  // members, index, has
  ['self.hoehe', 12.5],
  ['self.flaeche.name', 'Park'],
  ['self.meta.x', 1],
  ["self.meta['name']", 'meta'],
  ["self['stage']", 'aktiv'],
  ['self.tags[1]', 'b'],
  ["{'a': 5}['a']", 5],
  ['[10, 20][0]', 10],
  ['form.hoehe', 4.5],
  ["'viewer' in actor.roles", true],
  ['inputs.limit', 10],
  ['value * 2', 5],
  ['other.stage', 'erledigt'],
  ['area.name', 'Park'],
  ['area.baeume[0].art', 'Linde'],
  ['has(self.hoehe)', true],
  ['has(self.notiz)', false],
  ['has(self.flaeche)', true],
  ['has(other.flaeche)', false],
  ['has(self.meta.x)', true],
  ['has(self.meta.y)', false],
  ['has(form.foto)', false],
  // relations
  ['self.kontrollen.size()', 2],
  ['size(self.kontrollen)', 2],
  ['self.kontrollen.exists(k, k.ok)', true],
  ['self.kontrollen.all(k, k.ok)', false],
  ['self.kontrollen.filter(k, k.ok).size()', 1],
  ['self.kontrollen.map(k, k.ok)', [true, false]],
  ['other.kontrollen.exists(k, k.ok)', false],
  ['other.kontrollen.all(k, k.ok)', true],
  ["self.kontrollen.exists(k, k.note == 'gut')", true],
  ["area.baeume.all(b, b.stage == 'aktiv')", true],
  ['[1, 2, 3].map(x, x * 2)', [2, 4, 6]],
  ['[1, 2, 3, 4].filter(x, x % 2 == 0)', [2, 4]],
  ['[1, 2].exists(x, [3, 4].exists(y, x + y == 5))', true],
  ['[1, 2].all(x, [3, 4].all(y, y > x))', true],
  ["{'a': 1, 'b': 2}.exists(k, k == 'b')", true],
  // text
  ["'hello'.startsWith('he')", true],
  ["'hello'.endsWith('lo')", true],
  ["'hello'.contains('ell')", true],
  ["'hello'.contains('z')", false],
  ["'Hello'.lower()", 'hello'],
  ["'Hello'.upper()", 'HELLO'],
  ["'häh'.size()", 3],
  ["size('\\U0001F600')", 1],
  ["size({'a': 1})", 1],
  ['size([1, 2, 3])', 3],
  ["self.art.startsWith('Li')", true],
  // time (now is injected)
  ['now', NOW],
  ['today()', TODAY],
  ["date('2026-09-30')", '2026-09-30T00:00:00.000Z'],
  ["date('2026-09-30T10:00:00Z')", '2026-09-30T10:00:00.000Z'],
  ["days_between(date('2026-09-01'), date('2026-09-29'))", 28],
  ["days_between(date('2026-09-29'), date('2026-09-01'))", -28],
  ["date('2026-09-29') + days(2)", '2026-10-01T00:00:00.000Z'],
  ["date('2026-09-29') - days(1)", '2026-09-28T00:00:00.000Z'],
  ["date('2026-09-29') - date('2026-09-28') == days(1)", true],
  ['days(2) + days(3) == days(5)', true],
  ['days(3) - days(1) == days(2)', true],
  ['-days(1) < days(0)', true],
  ["today() + months(1) > date('2026-10-20')", true],
  ["date('2026-01-31') + months(1)", '2026-02-28T00:00:00.000Z'],
  ["date('2028-01-31') + months(1)", '2028-02-29T00:00:00.000Z'],
  ["date('2026-03-31') - months(1)", '2026-02-28T00:00:00.000Z'],
  ["date('2026-10-31') + months(4)", '2027-02-28T00:00:00.000Z'],
  ["date('2026-11-15T10:30:00Z') + months(3)", '2027-02-15T10:30:00.000Z'],
  ["date('2026-01-15') + months(12)", '2027-01-15T00:00:00.000Z'],
  ["date('2026-01-15') + months(-2)", '2025-11-15T00:00:00.000Z'],
  ["months(2) + date('2026-01-15')", '2026-03-15T00:00:00.000Z'],
  ["date('2026-01-31') + (months(1) + days(2))", '2026-03-02T00:00:00.000Z'],
  ["date('2026-01-31') + (months(1) - months(1))", '2026-01-31T00:00:00.000Z'],
  ['months(1) + months(2) == months(3)', true],
  ['-months(1) + months(1) == days(0)', true],
  ["now > date('2026-09-29')", true],
  ["now < date('2026-09-29')", false],
  ['self.pruefung < now - days(200)', true],
  ['self.pruefung + months(12) > now', true],
  ['days_between(self.pruefung, today()) > 200', true],
  ["date('2026-09-29') == today()", true],
  // history
  ["last('stage', 5)", ['aktiv', 'neu']],
  ["last('hoehe', 2)", [12.5, 11]],
  ["changed('stage')", true],
  ["changed('hoehe')", true],
  ["previous('hoehe')", 11],
  ["previous('art')", null],
  // changed_at: the time of the newest observation of the property (WP-389)
  ["changed_at('stage')", '2026-02-03T10:00:00.000Z'],
  ["changed_at('hoehe')", '2026-02-06T10:00:00.000Z'],
  ["changed_at('notiz')", null],
  ["changed_at('hoehe') + days(1) < now", true],
  ["count('hoehe')", 3],
  ["count('notiz')", 0],
  ["last('hoehe', 1)[0] > 12", true],
  // spatial (GeoJSON-shaped map literals accepted as geometry)
  ['intersects(self.geom, area.geom)', true],
  ['within(self.geom, area.geom)', true],
  ['contains(area.geom, self.geom)', true],
  ['disjoint(other.geom, area.geom)', true],
  ['intersects(other.geom, area.geom)', false],
  ['touches(self.geom, area.geom)', false],
  ["within({'type': 'Point', 'coordinates': [9.5, 52.0]}, area.geom)", true],
  [
    "contains({'type': 'Polygon', 'coordinates': [[[9.0, 51.5], [10.0, 51.5], [10.0, 52.5], [9.0, 52.5], [9.0, 51.5]]]}, self.geom)",
    true,
  ],
  ["disjoint({'type': 'Point', 'coordinates': [0.0, 0.0]}, self.geom)", true],
  ['distance(self.geom, self.geom)', 0],
  [
    "distance({'type': 'Point', 'coordinates': [0.0, 0.0]}, {'type': 'Point', 'coordinates': [0.0, 1.0]}) > 111000.0",
    true,
  ],
  [
    "distance({'type': 'Point', 'coordinates': [0.0, 0.0]}, {'type': 'Point', 'coordinates': [0.0, 1.0]}) < 111500.0",
    true,
  ],
  ['distance(self.geom, area.geom)', 0],
  ["dwithin(self.geom, {'type': 'Point', 'coordinates': [9.5, 52.0009]}, 200.0)", true],
  ["dwithin(self.geom, {'type': 'Point', 'coordinates': [9.5, 52.1]}, 200.0)", false],
  ['area(area.geom) > 6.0e9', true],
  ['area(area.geom) < 8.0e9', true],
  ['area(self.geom)', 0],
  ['length(area.geom) > 3.5e5', true],
  ['length(self.geom)', 0],
];

/** Null semantics (docs/06): missing is null; null propagates; the result is a value, not an error. */
export const EVAL_NULL: readonly string[] = [
  'self.notiz',
  'self.meta.gone + 1',
  'self.meta.gone < 3',
  'self.meta.gone > self.hoehe',
  'other.flaeche.name',
  'other.flaeche',
  "self.notiz.startsWith('a')",
  'self.notiz.size()',
  'self.notiz.lower()',
  '!self.meta.gone',
  'self.meta.gone ? 1 : 2',
  '-self.meta.gone',
  'self.meta.gone.deeper',
  "self.meta['gibtsnicht']",
  'form.foto',
  'true && self.meta.gone',
  'self.meta.gone || false',
  'intersects(self.meta.gone, area.geom)',
  'days_between(self.meta.gone, now)',
  'date(self.notiz)',
  'self.meta.gone.exists(x, x)',
  'self.meta.gone[0]',
];

/** Absorption: `false && x` and `true || x` hold whatever x is (also null or an error). */
export const EVAL_ABSORB: readonly (readonly [string, boolean])[] = [
  ['false && self.meta.gone', false],
  ['self.meta.gone && false', false],
  ['true || self.meta.gone', true],
  ['self.meta.gone || true', true],
  ['false && (1 / 0 == 1)', false],
  ['(1 / 0 == 1) && false', false],
  ['true || (1 / 0 == 1)', true],
  ['(1 / 0 == 1) || true', true],
];

/** [source, fragment of the error message]. Total: an error result, never a throw. */
export const EVAL_ERR: readonly (readonly [string, string])[] = [
  ['1 / 0', 'division by zero'],
  ['1 % 0', 'division by zero'],
  ['9007199254740991 + 1', 'overflow'],
  ['9007199254740991 * 2', 'overflow'],
  ['[1, 2][5]', 'out of range'],
  ['[1, 2][-1]', 'out of range'],
  ['self.tags[9]', 'out of range'],
  ["date('kein datum')", 'not a valid date'],
  ["date('2026-13-45')", 'not a valid date'],
  ["last('hoehe', inputs.limit - 10)", 'at least 1'],
  ['intersects(self.meta.x, area.geom)', 'not a geometry'],
  ['within(self.meta.name, area.geom)', 'not a geometry'],
  ["within({'type': 'Point', 'coordinates': ['x', 1]}, area.geom)", 'not a geometry'],
  ["area({'type': 'Polygon', 'coordinates': []})", 'geometry'],
  ['true && (1 / 0 == 1)', 'division by zero'],
  ['(1 / 0 == 1) || false', 'division by zero'],
  ['1 / 0 == 1 ? 1 : 2', 'division by zero'],
  ['[1, 2].map(x, x / 0)', 'division by zero'],
  ['[1, 2].filter(x, x / 0 == 1)', 'division by zero'],
];

/** Sources that check but mix types only known at run time (dyn): errors, not crashes. */
export const EVAL_DYN_ERR: readonly (readonly [string, string])[] = [
  ["self.meta.x + 'a'", 'cannot add'],
  ['self.meta.name * 2', 'cannot multiply'],
  ['self.meta.name < 3', 'cannot order'],
  ['self.meta.x.foo', 'cannot read'],
  ['self.meta.x[0]', 'cannot index'],
  ['self.meta.x.exists(i, true)', 'needs a list'],
  ['1 in self.meta.x', 'needs a list'],
  ['!self.meta.x', 'needs a bool'],
  ['self.meta.name ? 1 : 2', 'needs a bool'],
  ['self.meta.name && true', 'needs a bool'],
  ['-self.meta.name', 'cannot negate'],
  ['self.meta.x % 1.5', 'int'],
  ['self.meta.x / self.meta.name', 'cannot divide'],
];
