/**
 * Sample data of the demo, all of it runs (R3): the first features arrive as import runs (`importFile`, actor kind
 * `import`), later stages come from runs of the roles themselves (inspections, assessments, approvals), so rules,
 * stages and open tasks look like a used installation. Ids are counters, so a reset reproduces them.
 */
import {
  createGeo,
  type Actor,
  type FeatureId,
  type Ids,
  type Json,
  type Key,
  type RunId,
} from '@ueberblick/core';
import {
  composeProjectStore,
  configCacheFor,
  createLogger,
  importFile,
  openProjectDb,
  type Db,
  type ImportMapping,
  type Store,
} from '@ueberblick/server';
import {
  addDays,
  areas,
  buildings,
  einsatzCsv,
  events,
  melderCsv,
  rectangle,
  reports,
  startCentre,
  trees,
  type Centre,
} from './data';

const clock = { now: (): string => new Date().toISOString() };

/** Counter ids in UUIDv7 shape (the wire format of runs and features wants UUIDs), so a reset reproduces them. */
function counterIds(): Ids {
  let run = 0;
  let feature = 0;
  const uuid = (kind: number, n: number): string =>
    `${String(kind).padStart(8, '0')}-0000-7000-8000-${String(n).padStart(12, '0')}`;
  return {
    runId: () => uuid(1, ++run) as RunId,
    featureId: () => uuid(2, ++feature) as FeatureId,
  };
}

const actor = (kind: Actor['kind'], id: string, ...roles: string[]): Actor => ({
  id,
  kind,
  roles: roles as Key[],
});

export interface Sample {
  readonly store: Store;
  readonly db: Db;
  readonly version: number;
  readonly ids: Ids;
  readonly today: Date;
  /** Where this project's sample data lies: the `map.start` of its deployed config (R1: one source). */
  readonly centre: Centre;
  /** Imports a GeoJSON file through the creating task; throws on any problem. */
  load(file: string, mapping: ImportMapping, as: Actor, format?: 'geojson' | 'csv'): number;
  /** Submits one run of a task; throws with the refusal when it is not accepted. */
  run(task: string, who: Actor, input: Record<string, Json>, feature?: string): void;
  /** The ids of the features of a type, in creation order. */
  idsOf(type: string): string[];
}

export function openSample(dir: string, key: string): Sample {
  const db = openProjectDb(dir, key);
  const deployed = configCacheFor(db).deployed();
  if (deployed === undefined)
    throw new Error(`project ${key} has no deployed config: deploy before populating`);
  const ids = counterIds();
  const store = composeProjectStore(db, {
    clock,
    log: createLogger({ sink: () => undefined, now: () => Date.now() }),
    ids,
    onOrphanedBlobs: () => undefined,
  });
  const geo = createGeo();
  const today = new Date();
  return {
    store,
    db,
    ids,
    today,
    centre: startCentre(deployed.config.file),
    version: deployed.version,
    load(file, mapping, as, format = 'geojson') {
      const r = importFile(
        store,
        { format, data: file },
        { sourceCrs: 'EPSG:4326', ...mapping },
        { config: deployed.config, configVersion: deployed.version, actor: as, ids, geo },
      );
      if (r.outcome !== 'accepted')
        throw new Error(`import ${mapping.task} refused: ${JSON.stringify(r.problems[0])}`);
      return r.imported;
    },
    run(task, who, input, feature) {
      const r = store.submit({
        id: ids.runId(),
        task: task as Key,
        actor: who,
        configVersion: deployed.version,
        input,
        ...(feature === undefined ? {} : { featureId: feature as FeatureId }),
      });
      if (r.outcome !== 'accepted')
        throw new Error(`run ${task} by ${who.id} refused: ${JSON.stringify(r.refusal)}`);
    },
    idsOf: (type) =>
      db
        .prepare<{ id: string }>('SELECT id FROM features WHERE type = ? ORDER BY id')
        .all(type)
        .map((r) => r.id),
  };
}

const point = (c: Centre, i: number): Json => ({
  type: 'Point',
  coordinates: [round(c.lon - 0.005 + i * 0.002), round(c.lat - 0.002 + i * 0.001)],
});
const round = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The tree species a gardener picks from (`baumart`, a lookup table: the "Baumart" field offers these). */
const SPECIES: readonly (readonly [string, string])[] = [
  ['Linde', 'Tilia'],
  ['Ahorn', 'Acer'],
  ['Eiche', 'Quercus'],
  ['Platane', 'Platanus'],
  ['Buche', 'Fagus'],
  ['Kastanie', 'Aesculus'],
];
const de = (text: string): Json => ({ de: text });

function trees_(s: Sample): void {
  const anna = actor('participant', 'participant-1', 'kontrolle');
  const bernd = actor('participant', 'bernd', 'bauhof');
  const vera = actor('participant', 'vera', 'verwaltung');
  for (const [nameDe, nameLat] of SPECIES)
    s.run('baumart_anlegen', vera, { name_de: nameDe, name_lat: nameLat });
  s.load(
    areas(s.centre),
    { task: 'flaeche_anlegen' as Key, fields: { name: 'name' }, geometry: { field: 'geometrie' } },
    actor('import', 'import-demo', 'verwaltung'),
  );
  s.load(
    trees(1001, 150, s.centre),
    {
      task: 'erfassen' as Key,
      fields: { vitalitaet: 'vitalitaet', beschreibung: { column: 'beschreibung', language: 'de' } },
      geometry: { field: 'geometrie' },
    },
    actor('import', 'import-demo', 'verwaltung'),
  );
  const all = s.idsOf('baum');
  all.forEach((id, i) => {
    if (i % 10 === 0) {
      const vital = i % 50 === 0 ? 'v3' : i % 30 === 0 ? 'v4' : 'v2';
      s.run(
        'kontrolle',
        anna,
        { vitalitaet: vital, befund: `Kontrolle ${i}: ${vital === 'v2' ? 'unauffällig' : 'Schaden'}` },
        id,
      );
    }
    if (i % 12 === 5) s.run('zuweisen', vera, { zustaendig: 'participant-1' }, id);
  });
  for (const id of s.idsOf('massnahme').slice(0, 2)) s.run('massnahme_erledigen', bernd, {}, id);
}

function reports_(s: Sample): void {
  const mia = actor('participant', 'mia', 'melder');
  const sven = actor('participant', 'sven', 'sachbearbeiter');
  const hanna = actor('participant', 'hanna', 'handwerker');
  s.load(
    reports(2002, 70, s.centre),
    {
      task: 'melden' as Key,
      fields: { kategorie: 'kategorie', beschreibung: { column: 'beschreibung', language: 'de' } },
      geometry: { field: 'geometrie' },
    },
    actor('import', 'import-demo', 'sachbearbeiter'),
  );
  [
    'Schlagloch vor der Schule',
    'Laterne flackert am Kirchplatz',
    'Müll am Spielplatz',
    'Gehwegplatte lose',
    'Bank defekt',
  ].forEach((text, i) =>
    s.run('melden', mia, {
      geometrie: point(s.centre, i),
      kategorie: i % 2 === 0 ? 'strasse' : 'beleuchtung',
      beschreibung: de(text),
    }),
  );
  const all = s.idsOf('meldung');
  all
    .slice(0, 15)
    .forEach((id, i) => s.run('bewerten', sven, { prioritaet: i % 4 === 0 ? 'hoch' : 'normal' }, id));
  all.slice(0, 10).forEach((id) => s.run('zuweisen', sven, { zustaendig: 'hanna' }, id));
  all.slice(0, 4).forEach((id) => s.run('erledigen', sven, {}, id));
  // the reporter's own reports (an import run with the reporter as actor: `melden` sets `melder` from the actor),
  // (all with a position: `geometrie` is required on `meldung`, so a report without one is refused); and the
  // technician's work orders
  const miaImport = actor('import', 'mia', 'melder');
  const fields = { kategorie: 'kategorie', beschreibung: { column: 'beschreibung', language: 'de' } };
  s.load(
    melderCsv(2003, 5, s.centre),
    { task: 'melden' as Key, fields, geometry: { field: 'geometrie', x: 'lon', y: 'lat' } },
    miaImport,
    'csv',
  );
  s.load(
    einsatzCsv('hanna', [
      'Laterne Bahnhofstraße tauschen',
      'Schlagloch verfüllen',
      'Papierkörbe leeren',
      'Spielgerät prüfen',
    ]),
    { task: 'einsatz_anlegen' as Key, fields: { titel: 'titel', zustaendig: 'zustaendig' } },
    actor('import', 'import-demo', 'sachbearbeiter'),
    'csv',
  );
  s.idsOf('einsatz')
    .slice(0, 2)
    .forEach((id) => s.run('einsatz_beginnen', hanna, {}, id));
}

function events_(s: Sample): void {
  const toni = actor('participant', 'toni', 'antragsteller');
  const olga = actor('participant', 'olga', 'sachbearbeiter');
  const felix = actor('participant', 'felix', 'brandschutz');
  s.load(
    buildings(3003, 12, s.centre),
    { task: 'gebaeude_erfassen' as Key, fields: { name: 'name' }, geometry: { field: 'geometrie' } },
    actor('import', 'import-demo', 'sachbearbeiter'),
  );
  s.load(
    events(3004, 24, s.today, s.centre),
    {
      task: 'beantragen' as Key,
      fields: { titel: 'titel', datum: 'datum' },
      geometry: { field: 'geometrie' },
    },
    actor('import', 'import-demo', 'antragsteller'),
  );
  ['Hoffest', 'Kinderflohmarkt', 'Straßenmusik', 'Nachbarschaftsfest'].forEach((titel, i) =>
    s.run('beantragen', toni, {
      titel,
      datum: addDays(s.today, 100 + i * 5),
      geometrie: {
        type: 'Polygon',
        coordinates: rectangle(s.centre.lon - 0.01, s.centre.lat - 0.005 + i * 0.002, 100, 130),
      },
    }),
  );
  const all = s.idsOf('veranstaltung');
  all
    .slice(0, 8)
    .forEach((id) => s.run('pruefen', olga, { interne_bewertung: 'Unterlagen vollständig' }, id));
  all
    .slice(0, 3)
    .forEach((id) => s.run('auflage_erteilen', felix, { text: de('Fluchtwege freihalten') }, id));
  all.slice(3, 5).forEach((id) => s.run('ablehnen', olga, { begruendung: 'Fläche nicht verfügbar' }, id));
  all.slice(5, 7).forEach((id) => s.run('genehmigen', olga, { begruendung: 'Genehmigt' }, id));
}

const BY_PROJECT: Record<string, (s: Sample) => void> = {
  musterstadt_baeume: trees_,
  stadtwerke_meldungen: reports_,
  ordnungsamt_veranstaltungen: events_,
};

/** Fills one deployed project with the demo's sample data. */
export function populate(dir: string, key: string): void {
  const fill = BY_PROJECT[key];
  if (fill === undefined) throw new Error(`no sample data for project ${key}`);
  const sample = openSample(dir, key);
  try {
    fill(sample);
  } finally {
    sample.db.close();
  }
}
