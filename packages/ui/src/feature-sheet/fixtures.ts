// Shared by the specs. Not exported from the package.
import type { Edge, FeatureId, FeatureType, FoldedFeature, Key, Property } from '@ueberblick/core/model';
import type { FeatureSheetInput } from './contract';

export const k = (s: string): Key => s as Key;
export const fid = (s: string): FeatureId => s as FeatureId;

export const TREE: FeatureType = {
  label: { en: 'Tree', de: 'Baum' },
  geometry: 'lage',
  properties: {
    name: { type: 'text', required: true, label: { en: 'Name', de: 'Name' } },
    hoehe: { type: 'number', label: { en: 'Height', de: 'Höhe' } },
    kontrolliert: { type: 'date', label: { en: 'Checked on', de: 'Kontrolliert am' } },
    gemeldet: { type: 'datetime', label: { en: 'Reported', de: 'Gemeldet' } },
    gesund: { type: 'boolean', label: { en: 'Healthy', de: 'Gesund' } },
    zustand: {
      type: 'select',
      label: { en: 'Condition', de: 'Zustand' },
      options: { gut: { en: 'Good', de: 'Gut' }, schlecht: { en: 'Poor', de: 'Schlecht' } },
    },
    melder: { type: 'participant', label: { en: 'Reporter', de: 'Melder' } },
    rolle: { type: 'role', label: { en: 'Responsible role', de: 'Zuständige Rolle' } },
    foto: { type: 'file', label: { en: 'Photo', de: 'Foto' } },
    lage: { type: 'geometry', label: { en: 'Location', de: 'Lage' } },
    flaeche: { type: 'geometry', label: { en: 'Crown', de: 'Krone' } },
    pate: { type: 'reference', to: k('person'), label: { en: 'Sponsor', de: 'Pate' } },
    geheim: { type: 'text', label: { en: 'Secret', de: 'Geheim' } },
  },
  relations: {
    in_gebiet: { to: k('gebiet'), derive: 'within(self.lage, other.flaeche)', cardinality: 'one' },
  },
};

export const AREA: FeatureType = {
  label: { en: 'Area', de: 'Gebiet' },
  properties: { name: { type: 'text' } },
  relations: { baeume: { to: k('baum'), inverse_of: 'baum.in_gebiet' } },
};

export const TYPES = { baum: TREE, gebiet: AREA };

export function tree(values: Record<string, never> | Record<string, unknown> = {}): FoldedFeature {
  return {
    id: fid('t1'),
    type: k('baum'),
    lifecycle: 'active',
    updatedSeq: 5,
    properties: {
      name: 'Oak',
      hoehe: 12.5,
      kontrolliert: '2026-03-04',
      gesund: true,
      zustand: 'schlecht',
      melder: 'p1',
      rolle: 'kontrolle',
      foto: [
        { sha256: 'a'.repeat(64), name: 'baum.jpg', mime: 'image/jpeg' },
        { sha256: 'b'.repeat(64), name: 'plan.pdf', mime: 'application/pdf' },
      ],
      geheim: 'hidden value',
      lage: { type: 'Point', coordinates: [8, 50] },
      flaeche: {
        type: 'Polygon',
        coordinates: [
          [
            [8, 50],
            [9, 50],
            [9, 51],
            [8, 50],
          ],
        ],
      },
      ...values,
    } as FoldedFeature['properties'],
    derived: {
      lage: {
        bbox: [8, 50, 8, 50],
        pointOnSurface: { type: 'Point', coordinates: [8, 50] },
        centroid: { type: 'Point', coordinates: [8, 50] },
        areaM2: 0,
        lengthM: 0,
      },
      flaeche: {
        bbox: [8, 50, 9, 51],
        pointOnSurface: { type: 'Point', coordinates: [8.5, 50.5] },
        centroid: { type: 'Point', coordinates: [8.5, 50.5] },
        areaM2: 1234.567,
        lengthM: 150,
      },
    },
  };
}

export function edge(from: string, relation: string, to: string, derived: boolean): Edge {
  return { from: fid(from), relation: k(relation), to: fid(to), derived };
}

export function input(over: Partial<FeatureSheetInput> = {}): FeatureSheetInput {
  return {
    feature: tree(),
    type: TREE,
    types: TYPES,
    availableTasks: [],
    taskLabels: {},
    edgesOut: [],
    edgesIn: [],
    activity: [],
    lookups: {
      participant: (id) => (id === 'p1' ? 'Anna Beispiel' : undefined),
      role: (key) => (key === 'kontrolle' ? 'Kontrolle' : undefined),
      feature: (id) => (id === 'g1' ? { label: 'Park', type: k('gebiet') } : undefined),
    },
    locale: 'en',
    timeZone: 'UTC',
    ...over,
  };
}

export function withProperty(p: Property): Property {
  return p;
}
