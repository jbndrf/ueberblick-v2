/** A small world for the relation specs: features with parents, a few types and tasks, and a `NavSource` over them. */
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Edge, FeatureId, Key } from '@ueberblick/core/model';
import type { FeatureSheetInput } from '@ueberblick/ui';
import type { NavDeps, NavSource } from './nav';

const k = (s: string): Key => s as Key;
const f = (s: string): FeatureId => s as FeatureId;

export const FILE = {
  types: {
    gebiet: {
      label: { de: 'Gebiet', en: 'Area' },
      properties: { name: { type: 'text' } },
      relations: {
        baeume: { to: 'baum', label: { de: 'Bäume', en: 'Trees' }, inverse_of: 'baum.gebiet' },
        randbaeume: { to: 'baum', inverse_of: 'baum.randlage' },
      },
    },
    baum: {
      label: { de: 'Baum', en: 'Tree' },
      properties: {
        gebiet: { type: 'reference', to: 'gebiet' },
        art: { type: 'reference', to: 'baumart' },
        stage: {
          type: 'select',
          options: { neu: { de: 'Neu', en: 'New' }, fertig: { de: 'Fertig', en: 'Done' } },
        },
      },
      process: { property: 'stage', start: 'neu', end: ['fertig'] },
      relations: { massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum' } },
    },
    baumart: { label: { de: 'Baumart' }, properties: { name: { type: 'text' } } },
    massnahme: {
      label: { de: 'Maßnahme', en: 'Measure' },
      properties: {
        baum: { type: 'reference', to: 'baum' },
        stage: { type: 'select', options: { offen: { de: 'Offen' }, erledigt: { de: 'Erledigt' } } },
      },
      process: { property: 'stage', start: 'offen', end: ['erledigt'] },
    },
  },
  tasks: {
    massnahme_anlegen: {
      label: { de: 'Maßnahme anlegen' },
      on: 'baum',
      creates: 'massnahme',
      then: [{ set: { baum: 'self' } }],
    },
    massnahme_erledigen: {
      label: { de: 'Erledigen' },
      on: 'massnahme',
      then: [{ set: { stage: "'erledigt'" } }],
    },
    baum_fertig: {
      label: { de: 'Baum fertig' },
      on: 'massnahme',
      bind: { baum: 'self.baum' },
      then: [{ set: { 'baum.stage': "'fertig'" } }],
    },
    kommentar: { label: { de: 'Kommentar' }, on: 'massnahme', form: { notiz: {} } },
  },
} as unknown as CompiledConfig['file'];

export interface Node {
  readonly type: string;
  readonly label?: string;
  readonly stage?: string;
  readonly lifecycle?: string;
  /** [relation, parent, derived?] */
  readonly parents?: readonly (readonly [string, string, boolean?])[];
  /** The tasks offered to the participant on this feature. */
  readonly tasks?: readonly string[];
}

export function world(nodes: Record<string, Node>): { source: NavSource; reads: { input: number } } {
  const reads = { input: 0 };
  const edgesOut = (id: string): Edge[] =>
    (nodes[id]?.parents ?? []).map(([relation, to, derived]) => ({
      from: f(id),
      relation: k(relation),
      to: f(to),
      derived: derived ?? false,
    }));
  const edgesIn = (id: string): Edge[] =>
    Object.keys(nodes).flatMap((o) => edgesOut(o).filter((e) => e.to === id));
  const source: NavSource = {
    sheetInput(id) {
      reads.input++;
      const n = nodes[id];
      if (n === undefined) return undefined;
      const type = (FILE.types as Record<string, never>)[n.type];
      return {
        feature: {
          id: f(id),
          type: k(n.type),
          lifecycle: n.lifecycle ?? 'active',
          updatedSeq: 1,
          properties: n.stage === undefined ? {} : { stage: n.stage },
          derived: {},
          changedAt: '2026-10-01T10:00:00Z',
        },
        type,
        types: FILE.types,
        availableTasks: n.tasks ?? [],
        taskLabels: {},
        edgesOut: edgesOut(id),
        edgesIn: edgesIn(id),
        activity: [],
        lookups: {
          participant: () => undefined,
          feature: (other: FeatureId) => {
            const o = nodes[other];
            return o === undefined ? undefined : { label: o.label ?? other, type: k(o.type) };
          },
        },
        locale: 'de',
      } as unknown as FeatureSheetInput;
    },
    availableTasks: (id) => (nodes[id]?.tasks ?? []).map(k),
  };
  return { source, reads };
}

export const deps = (source: NavSource): NavDeps => ({ source, file: FILE, locale: 'de' });
