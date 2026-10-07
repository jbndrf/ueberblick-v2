/**
 * Validity report and repair. Structural checks are plain arithmetic on positions. Topology (self-intersection,
 * holes, overlapping members) is decided by the engine, so no predicate is hand-written here.
 */
import type { GeoEngine, Geometry, Position, RepairResult, ValidityReport } from './contract';
import { at, signedArea2, type Ring } from './coords';
import { normalise } from './normalise';
import type { GeoValidityIssue } from '../registry';

type Issue = ValidityReport['issues'][number];

/** Issues no repair can fix: there is nothing to build a geometry from. */
const UNFIXABLE: readonly GeoValidityIssue[] = ['empty', 'non_finite', 'out_of_range', 'too_few_points'];
/** Issues `normalise` fixes silently. */
const SHAPE_ONLY: readonly GeoValidityIssue[] = ['ring_not_closed', 'wrong_winding'];

const closed = (r: Ring) =>
  r.length > 0 && at(r, 0)[0] === at(r, r.length - 1)[0] && at(r, 0)[1] === at(r, r.length - 1)[1];

function positions(ps: readonly Position[], path: string, out: Issue[]): boolean {
  if (ps.length === 0) {
    out.push({ issue: 'empty', path });
    return false;
  }
  let ok = true;
  for (const p of ps) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || (p.length === 3 && !Number.isFinite(p[2]))) {
      out.push({ issue: 'non_finite', path });
      return false;
    }
    if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) ok = false;
  }
  if (!ok) out.push({ issue: 'out_of_range', path });
  return ok;
}

function line(ps: readonly Position[], path: string, out: Issue[]): void {
  if (!positions(ps, path, out)) return;
  if (ps.length < 2) out.push({ issue: 'too_few_points', path });
}

function ringChecks(r: Ring, exterior: boolean, path: string, out: Issue[]): void {
  if (!positions(r, path, out)) return;
  if (r.length < 3 || (closed(r) && r.length < 4)) {
    out.push({ issue: 'too_few_points', path });
    return;
  }
  if (!closed(r)) {
    out.push({ issue: 'ring_not_closed', path });
    return;
  }
  const area = signedArea2(r);
  if (area !== 0 && area > 0 !== exterior) out.push({ issue: 'wrong_winding', path });
}

function polygonChecks(rings: readonly Ring[], path: string, out: Issue[]): void {
  if (rings.length === 0) out.push({ issue: 'empty', path });
  rings.forEach((r, i) => ringChecks(r, i === 0, `${path}/${i}`, out));
}

function structure(g: Geometry, path: string, out: Issue[]): void {
  switch (g.type) {
    case 'Point':
      positions([g.coordinates], path + '/coordinates', out);
      return;
    case 'MultiPoint':
      positions(g.coordinates, path + '/coordinates', out);
      return;
    case 'LineString':
      line(g.coordinates, path + '/coordinates', out);
      return;
    case 'MultiLineString':
      if (g.coordinates.length === 0) out.push({ issue: 'empty', path: path + '/coordinates' });
      g.coordinates.forEach((l, i) => line(l, `${path}/coordinates/${i}`, out));
      return;
    case 'Polygon':
      polygonChecks(g.coordinates, path + '/coordinates', out);
      return;
    case 'MultiPolygon':
      if (g.coordinates.length === 0) out.push({ issue: 'empty', path: path + '/coordinates' });
      g.coordinates.forEach((p, i) => polygonChecks(p, `${path}/coordinates/${i}`, out));
      return;
    case 'GeometryCollection':
      if (g.geometries.length === 0) out.push({ issue: 'empty', path });
      g.geometries.forEach((m, i) => structure(m, `${path}/geometries/${i}`, out));
  }
}

const polygonOf = (rings: readonly Ring[]): Geometry => ({ type: 'Polygon', coordinates: rings });
const ringPolygon = (r: Ring): Geometry => polygonOf([r]);

/** Name the topological fault of one polygon that the engine rejects. */
function polygonFault(engine: GeoEngine, rings: readonly Ring[], path: string, out: Issue[]): void {
  if (engine.isValid(polygonOf(rings))) return;
  const start = out.length;
  const shell = at(rings, 0);
  if (!engine.isValid(ringPolygon(shell))) {
    out.push({ issue: 'self_intersection', path: `${path}/0` });
    return;
  }
  for (let i = 1; i < rings.length; i++) {
    if (!engine.isValid(ringPolygon(at(rings, i)))) {
      out.push({ issue: 'self_intersection', path: `${path}/${i}` });
    } else if (!engine.test('coveredBy', ringPolygon(at(rings, i)), ringPolygon(shell))) {
      out.push({ issue: 'hole_outside_shell', path: `${path}/${i}` });
    }
  }
  // Holes touching or overlapping each other, or a hole crossing the shell edge.
  if (out.length === start) out.push({ issue: 'self_intersection', path });
}

function topology(engine: GeoEngine, g: Geometry, path: string, out: Issue[]): void {
  switch (g.type) {
    case 'Polygon':
      polygonFault(engine, g.coordinates, path + '/coordinates', out);
      return;
    case 'MultiPolygon': {
      const before = out.length;
      g.coordinates.forEach((p, i) => polygonFault(engine, p, `${path}/coordinates/${i}`, out));
      if (out.length === before && !engine.isValid(g))
        out.push({ issue: 'nested_shells', path: path + '/coordinates' });
      return;
    }
    case 'GeometryCollection':
      g.geometries.forEach((m, i) => topology(engine, m, `${path}/geometries/${i}`, out));
      return;
    default:
  }
}

export function validate(engine: GeoEngine, g: Geometry): ValidityReport {
  const issues: Issue[] = [];
  structure(g, '', issues);
  const blocking = issues.some((i) => i.issue !== 'wrong_winding');
  // The engine needs well-formed input; wrong winding alone is fine for it.
  if (!blocking && !engine.isValid(g)) topology(engine, g, '', issues);
  return { valid: !issues.some((i) => i.issue !== 'wrong_winding'), issues };
}

export function repair(engine: GeoEngine, g: Geometry): RepairResult {
  const before = validate(engine, g);
  if (before.issues.some((i) => UNFIXABLE.includes(i.issue))) return { ok: false, issues: before.issues };
  const shaped = normalise(g);
  const fixed = new Set<GeoValidityIssue>(
    before.issues.map((i) => i.issue).filter((i) => SHAPE_ONLY.includes(i)),
  );
  if (engine.isValid(shaped)) return { ok: true, geometry: shaped, fixed: [...fixed] };
  const made = normalise(engine.makeValid(shaped));
  const after = validate(engine, made);
  if (!after.valid) return { ok: false, issues: after.issues };
  for (const i of before.issues) if (!SHAPE_ONLY.includes(i.issue)) fixed.add(i.issue);
  return { ok: true, geometry: made, fixed: [...fixed] };
}
