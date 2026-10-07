/**
 * Spatial functions (OGC Simple Features / CQL2 names), backed by core.geo. Geometry arguments are
 * `geometry` values or GeoJSON-shaped map literals (what `fromCql2` produces); the checker accepts both.
 */
import type { GeoPredicate } from '../../registry';
import { T } from '../check/ty';
import type { FunctionSig, Ty } from '../check/types';
import { cat, unsupported } from '../sql/frag';
import { defineFunction } from './define';
import { asGeometry, withGeo } from './geometry';
import { stringContains } from './text';
import { fail } from './support';

/** Every geometry parameter is `geometry`; `check` types GeoJSON-shaped map literals as geometry too. */
const geometries = (n: number): Ty[] => Array.from({ length: n }, () => T.geometry);
const sig = (arity: number, rest: readonly Ty[], returns: Ty): FunctionSig[] => [
  { params: [...geometries(arity), ...rest], returns },
];

const predicate = (name: GeoPredicate) =>
  defineFunction({
    name,
    sigs: sig(2, [], T.bool),
    evaluate: ({ args }, { ctx }) => {
      const a = asGeometry(args[0]);
      const b = asGeometry(args[1]);
      return withGeo(`test ${name} on`, () => ctx.geo.test(name, a, b));
    },
  });

export const intersects = predicate('intersects');
export const within = predicate('within');
export const touches = predicate('touches');
export const disjoint = predicate('disjoint');

/** Spatial `contains(a, b)` and text `s.contains(t)` share one name, so one entry. */
export const contains = defineFunction({
  name: 'contains',
  sigs: [...sig(2, [], T.bool), { target: T.string, params: [T.string], returns: T.bool }],
  // Only the text overload has SQL; spatial predicates are tested by core.geo after an R*Tree prefilter.
  sql: (call) => {
    const [s, t] = call.args;
    if (s === undefined || t === undefined || s.ty.kind !== 'string') return unsupported('spatial predicate');
    return cat('(instr(', s.frag, ', ', t.frag, ') > 0)');
  },
  evaluate: ({ target, args }, { ctx }) => {
    if (target !== undefined) return stringContains(target, args[0]);
    const a = asGeometry(args[0]);
    const b = asGeometry(args[1]);
    return withGeo('test contains on', () => ctx.geo.test('contains', a, b));
  },
});

export const distance = defineFunction({
  name: 'distance',
  sigs: sig(2, [], T.double),
  evaluate: ({ args }, { ctx }) => {
    const a = asGeometry(args[0]);
    const b = asGeometry(args[1]);
    return withGeo('measure', () => ctx.geo.distanceM(a, b));
  },
});

export const dwithin = defineFunction({
  name: 'dwithin',
  sigs: sig(2, [T.double], T.bool),
  evaluate: ({ args }, { ctx }) => {
    const m = args[2];
    if (typeof m !== 'number') return fail('the distance must be a number');
    const a = asGeometry(args[0]);
    const b = asGeometry(args[1]);
    return withGeo('measure', () => ctx.geo.dwithin(a, b, m));
  },
});

export const area = defineFunction({
  name: 'area',
  sigs: sig(1, [], T.double),
  evaluate: ({ args }, { ctx }) => {
    const g = asGeometry(args[0]);
    return withGeo('measure', () => ctx.geo.derive(g).areaM2);
  },
});

/** Length in metres; the perimeter for areas (`core.geo` `lengthM`). */
export const length = defineFunction({
  name: 'length',
  sigs: sig(1, [], T.double),
  evaluate: ({ args }, { ctx }) => {
    const g = asGeometry(args[0]);
    return withGeo('measure', () => ctx.geo.derive(g).lengthM);
  },
});

export const SPATIAL_FUNCTIONS = [
  intersects,
  within,
  contains,
  touches,
  disjoint,
  dwithin,
  distance,
  area,
  length,
];
