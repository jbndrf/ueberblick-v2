/**
 * The benchmark dataset generator (docs/12; spec: fixtures/golden/bench-spec.yaml). Deterministic: the same
 * seed gives byte-identical rows. Nothing it writes is committed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { createGeo, type Geometry, type Point, type SpatialIndex } from '../../packages/core/src/geo';
import { openProjectDb, type Db } from '../../packages/server/src';
import { createRandom, type Random } from './prng';
import { areaPolygon, clusterCentres, region, treePoint, type Region } from './shapes';
import { GOLDEN_DIR, loadSpec, scaleCounts, type BenchSpec } from './spec';
import { createWriter, type ObservationIn, type Writer } from './writer';

export interface GenerateOptions {
  readonly seed: number;
  readonly features: number;
  /** Template path relative to fixtures/golden; defaults to the spec's. */
  readonly template?: string;
  /** Directory for `project-bench.db`; in memory when omitted. */
  readonly dir?: string;
}

export interface GenerateResult {
  readonly db: Db;
  /** Hash over every inserted value in order: equal digests mean equal data. */
  readonly digest: string;
  readonly stats: {
    readonly byType: Record<string, number>;
    readonly observations: number;
    readonly derivedShare: number;
  };
}

const BASE_MS = Date.UTC(2026, 0, 1);
const CHUNK = 2000;
const ROLES = ['kontrolle', 'bauhof', 'verwaltung'] as const;
const FINDINGS = ['ohne Befund', 'Totholz', 'Pilzbefall', 'Stammriss', 'Wurzelaufbruch', 'Kronenschaden'];
const STAGES = ['erfasst', 'kontrolliert', 'massnahme', 'erledigt'];
const BAUM_PROPERTIES = [
  'geometrie',
  'art',
  'stage',
  'vitalitaet',
  'befund',
  'zustaendig',
  'faellig_am',
  'hoehe_m',
  'beschreibung',
];

const isoAt = (n: number) => new Date(BASE_MS + n * 1000).toISOString();
const isoDate = (n: number) => new Date(BASE_MS + n * 86_400_000).toISOString().slice(0, 10);

export function generate(opts: GenerateOptions): GenerateResult {
  const spec = loadSpec();
  const templatePath = opts.template ?? spec.template;
  const text = readFileSync(resolve(GOLDEN_DIR, templatePath), 'utf8');
  const template = parse(text) as {
    template: { key: string; version: string };
    types: Record<string, { properties: object }>;
  };
  assertTemplate(template);

  const rnd = createRandom(opts.seed);
  const db = openProjectDb(opts.dir ?? ':memory:', 'bench');
  const w = createWriter(db);
  const counts = scaleCounts(spec, opts.features);
  const reg = region(spec.region.bbox);
  // Clusters scale with the dataset, so the density (and the share of trees inside an area) stays the same.
  const clusters = Math.max(1, Math.round((spec.types.baum.clusters * opts.features) / spec.total_features));
  const geo = createGeo();
  let clock = 0;
  let observations = 0;
  const tick = () => isoAt(clock++);
  const idAt = () => rnd.uuid7(BASE_MS + clock);
  const runOf = (actor: { id: string; kind: string }, task: string, obs: ObservationIn[]): number => {
    observations += obs.length;
    return w.run(idAt(), actor, task, tick(), obs);
  };
  const importer = { id: 'bench-import', kind: 'import' };

  w.config(
    `${template.template.key}@${template.template.version}`,
    createHash('sha256').update(text).digest('hex'),
  );
  const participants = Array.from({ length: spec.assignment.participants }, (_, i) => {
    const id = idAt();
    w.participant(id, `Teilnehmer ${i + 1}`, [ROLES[i % ROLES.length] as string]);
    return { id, kind: 'participant', role: ROLES[i % ROLES.length] as string };
  });

  // Species: a lookup type without geometry.
  const speciesIds: string[] = [];
  w.batch(counts.baumart, CHUNK, (i) => {
    const id = idAt();
    speciesIds.push(id);
    const props = { name_de: `Art ${i + 1}`, name_lat: `Arbor ${i + 1}` };
    const last = runOf(importer, 'erfassung_import', [
      { featureId: id, property: '$type', result: 'baumart' },
      ...Object.entries(props).map(([property, result]) => ({ featureId: id, property, result })),
    ]);
    w.feature({ id, type: 'baumart', properties: props }, last);
  });

  const { polygons, centres } = generateAreas(
    spec,
    counts.flaeche,
    clusters,
    reg,
    rnd,
    geo,
    w,
    runOf,
    importer,
    idAt,
  );
  const index = geo.index(polygons.map(([, g], k) => [k, g] as const));
  const areaIds = polygons.map(([id]) => id);

  const treeIds: string[] = [];
  let withEdge = 0;
  w.batch(counts.baum, CHUNK, (i) => {
    const id = idAt();
    treeIds.push(id);
    const point = treePoint(reg, rnd, centres, spec.types.baum.cluster_sigma_m, i % 50 === 0);
    const last = createTree(id, i, point, spec, rnd, participants, speciesIds, runOf, importer, w);
    const hit = firstWithin(index, point);
    if (hit !== undefined) {
      withEdge++;
      w.derivedEdge(id, spec.derived_edges.relation.split('.')[1] ?? 'flaeche', areaIds[hit] as string, last);
    }
  });

  w.batch(counts.massnahme, CHUNK, (i) => {
    const id = idAt();
    const worker = rnd.pick(participants);
    const props = {
      baum: rnd.pick(treeIds),
      art: rnd.pick(['faellen', 'schnitt', 'ersatz']),
      ...(i % 3 === 0 ? { erledigt_am: isoDate(i % 300), zustaendig: worker.id } : {}),
    };
    const last = runOf(importer, 'erfassung_import', [
      { featureId: id, property: '$type', result: 'massnahme' },
      ...Object.entries(props).map(([property, result]) => ({ featureId: id, property, result })),
    ]);
    w.feature({ id, type: 'massnahme', properties: props }, last);
  });

  return {
    db,
    digest: w.digest(),
    stats: {
      byType: counts,
      observations,
      derivedShare: counts.baum === 0 ? 0 : withEdge / counts.baum,
    },
  };
}

function assertTemplate(t: { types: Record<string, { properties: object }> }): void {
  for (const type of ['baum', 'flaeche', 'massnahme', 'baumart'])
    if (!t.types[type]) throw new Error(`generate: the template has no type ${type}`);
  const have = Object.keys(t.types.baum?.properties ?? {});
  for (const p of BAUM_PROPERTIES)
    if (!have.includes(p)) throw new Error(`generate: type baum has no property ${p}`);
}

function firstWithin(index: SpatialIndex<number>, p: Point): number | undefined {
  const hits = index.query('within', p);
  return hits.length === 0 ? undefined : Math.min(...hits);
}

type RunOf = (actor: { id: string; kind: string }, task: string, obs: ObservationIn[]) => number;

function generateAreas(
  spec: BenchSpec,
  n: number,
  clusters: number,
  reg: Region,
  rnd: Random,
  geo: ReturnType<typeof createGeo>,
  w: Writer,
  runOf: RunOf,
  importer: { id: string; kind: string },
  idAt: () => string,
) {
  const centres = clusterCentres(reg, rnd, clusters);
  const polygons: [string, Geometry][] = [];
  const [vMin, vMax] = spec.types.flaeche.vertices;
  w.batch(n, CHUNK, (i) => {
    const id = idAt();
    // Areas sit near tree clusters, so about the expected share of trees falls inside one.
    const [lon0, lat0] = rnd.pick(centres);
    const centre = reg.offset(lon0, lat0, rnd.gauss() * 100, rnd.gauss() * 100);
    const g = geo.normalise(
      areaPolygon(
        reg,
        rnd,
        centre,
        150 + rnd.next() * 350,
        rnd.int(vMin, vMax),
        rnd.next() < spec.types.flaeche.holes_share,
      ),
    );
    const d = geo.derive(g);
    const props = { name: `Fläche ${i + 1}`, geometrie: g };
    const last = runOf(importer, 'erfassung_import', [
      { featureId: id, property: '$type', result: 'flaeche' },
      ...Object.entries(props).map(([property, result]) => ({ featureId: id, property, result })),
    ]);
    polygons.push([id, g]);
    w.feature(
      {
        id,
        type: 'flaeche',
        properties: props,
        geometry: {
          json: JSON.stringify(g),
          anchor: d.pointOnSurface.coordinates as [number, number],
          areaM2: d.areaM2,
        },
        bbox: d.bbox,
      },
      last,
    );
  });
  return { polygons, centres };
}

/** A tree: creation run, then (for `kontrollen_share`) 1 to 5 inspection runs; returns the last seq. */
function createTree(
  id: string,
  i: number,
  point: Point,
  spec: BenchSpec,
  rnd: Random,
  participants: readonly { id: string; kind: string; role: string }[],
  speciesIds: readonly string[],
  runOf: RunOf,
  importer: { id: string; kind: string },
  w: Writer,
): number {
  const props: Record<string, unknown> = {};
  const fold = (o: ObservationIn) => void (props[o.property] = o.result);
  const initial: ObservationIn[] = [
    { featureId: id, property: '$type', result: 'baum' },
    { featureId: id, property: 'geometrie', result: point },
    { featureId: id, property: 'art', result: rnd.pick(speciesIds) },
    { featureId: id, property: 'stage', result: 'erfasst' },
    { featureId: id, property: 'vitalitaet', result: String(rnd.int(0, 4)) },
    { featureId: id, property: 'befund', result: rnd.pick(FINDINGS) },
    { featureId: id, property: 'faellig_am', result: isoDate(300 + (i % 400)) },
    { featureId: id, property: 'hoehe_m', result: Math.round((3 + rnd.next() * 30) * 10) / 10 },
    { featureId: id, property: 'beschreibung', result: { de: `Baum ${i + 1}` } },
  ];
  if (rnd.next() < spec.assignment.assigned_share)
    initial.push({ featureId: id, property: 'zustaendig', result: rnd.pick(participants).id });
  initial.forEach(fold);
  let last = runOf(importer, 'erfassung_import', initial);

  if (rnd.next() < spec.history.kontrollen_share) {
    const { min, max } = spec.history.observations_per_property;
    const extra = rnd.int(Math.max(min, 2) - 1, max - 1);
    const inspector = participants.find((p) => p.role === 'kontrolle') ?? rnd.pick(participants);
    for (let k = 1; k <= extra; k++) {
      const vit = rnd.int(0, 4);
      const obs: ObservationIn[] = [
        { featureId: id, property: 'vitalitaet', result: String(vit) },
        { featureId: id, property: 'befund', result: rnd.pick(FINDINGS) },
        { featureId: id, property: 'stage', result: STAGES[vit >= 3 ? 2 : 1] },
      ];
      obs.forEach(fold);
      last = runOf(inspector, 'kontrolle', obs);
    }
  }
  const geometry = {
    json: JSON.stringify(point),
    anchor: [point.coordinates[0], point.coordinates[1]] as const,
    areaM2: 0,
  };
  const [lon, lat] = geometry.anchor;
  w.feature({ id, type: 'baum', properties: props, geometry, bbox: [lon, lat, lon, lat] }, last);
  return last;
}
