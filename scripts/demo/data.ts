/**
 * Deterministic sample data for the demo: a seeded generator (no Math.random) and the GeoJSON files the demo
 * imports. The same call gives the same features in the same order, so a reset reproduces ids and counts.
 */

/** Where a template has no `map.start`: the centre of Musterstadt in WGS84 (the golden seeds use the same area). */
export const TOWN = { lon: 7.1, lat: 50.735 } as const;

export interface Centre {
  readonly lon: number;
  readonly lat: number;
}

/** The centre of a project's sample data: its compiled config's `map.start` (the view the app opens on), else `TOWN`. */
export function startCentre(config: {
  readonly map?: { readonly start?: { readonly center: readonly number[] } | undefined } | undefined;
}): Centre {
  const c = config.map?.start?.center;
  return c === undefined ? TOWN : { lon: c[0] as number, lat: c[1] as number };
}

export type Rand = () => number;

/** mulberry32: a small seeded generator. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rand: Rand, items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;

/** Points along a few streets and around a few parks: clusters look more like a town than uniform noise. */
export function townPoints(rand: Rand, n: number, town: Centre = TOWN): [number, number][] {
  const centres: [number, number, number][] = [
    [town.lon - 0.012, town.lat + 0.004, 0.004],
    [town.lon + 0.008, town.lat - 0.003, 0.005],
    [town.lon, town.lat, 0.006],
    [town.lon + 0.014, town.lat + 0.007, 0.003],
    [town.lon - 0.006, town.lat - 0.008, 0.004],
    [town.lon + 0.002, town.lat + 0.009, 0.004],
  ];
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [lon, lat, spread] = centres[i % centres.length] as [number, number, number];
    const dx = (rand() + rand() + rand() - 1.5) * spread * 2;
    const dy = (rand() + rand() + rand() - 1.5) * spread;
    out.push([round(lon + dx), round(lat + dy)]);
  }
  return out;
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6;

/** A rectangle of about `wM` x `hM` metres around a point, as a closed GeoJSON ring. */
export function rectangle(lon: number, lat: number, wM: number, hM: number): [number, number][][] {
  const dx = wM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dy = hM / 2 / 110_540;
  const ring: [number, number][] = [
    [round(lon - dx), round(lat - dy)],
    [round(lon + dx), round(lat - dy)],
    [round(lon + dx), round(lat + dy)],
    [round(lon - dx), round(lat + dy)],
    [round(lon - dx), round(lat - dy)],
  ];
  return [ring];
}

export interface GeoFeature {
  readonly type: 'Feature';
  readonly properties: Record<string, string>;
  readonly geometry: { readonly type: 'Point' | 'Polygon'; readonly coordinates: unknown };
}

export const collection = (features: readonly GeoFeature[]): string =>
  JSON.stringify({ type: 'FeatureCollection', features });

const STREETS = ['Lindenallee', 'Bahnhofstraße', 'Kirchplatz', 'Am Stadtpark', 'Mühlenweg', 'Schulstraße'];
const VITALITY = ['v0', 'v1', 'v1', 'v2', 'v2', 'v2', 'v3', 'v4'] as const;

export function trees(seed: number, n: number, town: Centre): string {
  const rand = seeded(seed);
  return collection(
    townPoints(rand, n, town).map((coordinates, i) => ({
      type: 'Feature',
      properties: {
        vitalitaet: pick(rand, VITALITY),
        beschreibung: `${pick(rand, ['Linde', 'Ahorn', 'Eiche', 'Platane', 'Buche', 'Kastanie'])}, ${pick(rand, STREETS)} ${i + 1}`,
      },
      geometry: { type: 'Point', coordinates },
    })),
  );
}

const DEFECTS: Record<string, readonly string[]> = {
  strasse: ['Schlagloch', 'Gehwegplatte lose', 'Bordstein abgesackt'],
  beleuchtung: ['Laterne defekt', 'Laterne flackert'],
  muell: ['Wilde Müllkippe', 'Überfüllter Papierkorb'],
  spielplatz: ['Schaukel beschädigt', 'Sandkasten verschmutzt'],
};

export function reports(seed: number, n: number, town: Centre): string {
  const rand = seeded(seed);
  const categories = Object.keys(DEFECTS);
  return collection(
    townPoints(rand, n, town).map((coordinates) => {
      const kategorie = pick(rand, categories);
      return {
        type: 'Feature',
        properties: {
          kategorie,
          beschreibung: `${pick(rand, DEFECTS[kategorie] ?? [])}, ${pick(rand, STREETS)}`,
        },
        geometry: { type: 'Point', coordinates },
      };
    }),
  );
}

const EVENTS = [
  'Stadtfest',
  'Wochenmarkt',
  'Lauf durch die Altstadt',
  'Flohmarkt',
  'Konzert im Park',
  'Laternenumzug',
];
/** Six disjoint districts (3 x 2) that cover every point of `townPoints`: a tree is within exactly one of them. */
export function areas(town: Centre): string {
  const names = ['Nordwest', 'Nord', 'Nordost', 'Südwest', 'Süd', 'Südost'];
  return collection(
    names.map((name, i) => {
      // the first row (i < 3) is the northern one: its south edge is the centre line
      const lon0 = town.lon - 0.045 + (i % 3) * 0.03;
      const lat0 = town.lat - 0.03 + (i < 3 ? 0.03 : 0);
      const ring = [
        [lon0, lat0],
        [lon0 + 0.03, lat0],
        [lon0 + 0.03, lat0 + 0.03],
        [lon0, lat0 + 0.03],
        [lon0, lat0],
      ];
      return {
        type: 'Feature',
        properties: { name: `Stadtteil ${name}` },
        geometry: { type: 'Polygon', coordinates: [ring] },
      };
    }),
  );
}

export const addDays = (today: Date, days: number): string => {
  const d = new Date(today.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

/** `n` event sites; each has its own date (from `today` + 10 days, three days apart), so none collides with another. */
export function events(seed: number, n: number, today: Date, town: Centre): string {
  const rand = seeded(seed);
  return collection(
    townPoints(rand, n, town).map(([lon, lat], i) => ({
      type: 'Feature',
      properties: { titel: `${pick(rand, EVENTS)} ${i + 1}`, datum: addDays(today, 10 + i * 3) },
      geometry: { type: 'Polygon', coordinates: rectangle(lon, lat, 40 + rand() * 80, 30 + rand() * 60) },
    })),
  );
}

/** Reports of one reporter as CSV: `kategorie,beschreibung`, plus `lon,lat` when with a position. */
export function melderCsv(seed: number, n: number, town: Centre, withPosition = true): string {
  const rand = seeded(seed);
  const rows = townPoints(rand, n, town).map(([lon, lat]) => {
    const kategorie = pick(rand, Object.keys(DEFECTS));
    const text = `${pick(rand, DEFECTS[kategorie] ?? [])} ${pick(rand, STREETS)}`;
    return withPosition ? [kategorie, text, String(lon), String(lat)] : [kategorie, text];
  });
  const header = withPosition ? 'kategorie,beschreibung,lon,lat' : 'kategorie,beschreibung';
  return [header, ...rows.map((r) => r.join(','))].join('\n');
}

/** Work orders of one technician as CSV (`titel,zustaendig`). */
export function einsatzCsv(participant: string, titles: readonly string[]): string {
  return ['titel,zustaendig', ...titles.map((t) => `${t},${participant}`)].join('\n');
}

export function buildings(seed: number, n: number, town: Centre): string {
  const rand = seeded(seed);
  return collection(
    townPoints(rand, n, town).map(([lon, lat], i) => ({
      type: 'Feature',
      properties: { name: `${pick(rand, ['Rathaus', 'Schule', 'Halle', 'Museum', 'Feuerwache'])} ${i + 1}` },
      geometry: { type: 'Polygon', coordinates: rectangle(lon, lat, 25 + rand() * 30, 20 + rand() * 25) },
    })),
  );
}
