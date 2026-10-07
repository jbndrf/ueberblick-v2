/** Test data of the detail page: one Objektart with a process, a feature and its history (newest first). */
import type { HistoryRun } from '@ueberblick/server';
import type { ApiRow, DetailInput, TypeDef } from './model';

export const type = {
  label: { de: 'Baum', en: 'Tree' },
  geometry: 'geometrie',
  process: { property: 'stage', start: 'erfasst', end: ['gefaellt'] },
  properties: {
    geometrie: { type: 'geometry', geometry_type: 'point' },
    stage: {
      type: 'select',
      options: {
        erfasst: { de: 'Erfasst' },
        kontrolliert: { de: 'Kontrolliert' },
        gefaellt: { de: 'Gefällt' },
      },
    },
    titel: { type: 'text', label: { de: 'Titel' }, required: true },
    befund: { type: 'text', label: { de: 'Befund' } },
    hoehe_m: { type: 'number', label: { de: 'Höhe (m)' } },
    kontrolle_faellig: { type: 'boolean', label: { de: 'Kontrolle fällig' } },
    zustaendig: {
      type: 'participant',
      label: { de: 'Zuständig' },
      display: { tab: { de: 'Pflege' }, tab_order: 1 },
    },
  },
} as unknown as TypeDef;

export const row: ApiRow = {
  $id: 'f1',
  $lifecycle: 'active',
  $created_by: 'u1',
  $created_at: '2026-03-01T10:00:00.000Z',
  $changed_at: '2026-03-04T10:00:00.000Z',
  lon: 7.1,
  lat: 50.2,
  stage: 'kontrolliert',
  titel: 'Eiche am Markt',
  befund: 'Kronenpflege',
  hoehe_m: 12.5,
  kontrolle_faellig: true,
  zustaendig: 'u2',
};

const run = (id: string, over: Partial<HistoryRun>): HistoryRun => ({
  id,
  task: 'kontrolle',
  actor: { id: 'u1', kind: 'participant', name: null },
  receivedAt: '2026-03-02T10:00:00.000Z',
  clientTime: null,
  configVersion: 1,
  outcome: 'accepted',
  observations: [],
  ...over,
});

/** Newest first: a refused run, a two-field update, a move to Kontrolliert, the creation. */
export const runs: readonly HistoryRun[] = [
  run('r3', {
    receivedAt: '2026-03-04T10:00:00.000Z',
    outcome: 'refused',
    refusal: { code: 'invalid_input', message: 'Befund muss sich ändern' },
  }),
  run('r2', {
    receivedAt: '2026-03-03T10:00:00.000Z',
    actor: { id: 'u2', kind: 'participant', name: 'Bernd Beispiel' },
    observations: [
      { property: 'befund', result: 'Kronenpflege', time: null },
      { property: 'hoehe_m', result: 12.5, time: null },
    ],
  }),
  run('r1', {
    task: 'verschieben',
    receivedAt: '2026-03-02T10:00:00.000Z',
    observations: [{ property: 'stage', result: 'kontrolliert', time: null }],
  }),
  run('r0', {
    task: 'erfassen',
    receivedAt: '2026-03-01T10:00:00.000Z',
    observations: [
      { property: '$type', result: 'baum', time: null },
      { property: 'stage', result: 'erfasst', time: null },
      { property: 'titel', result: 'Eiche am Markt', time: null },
      { property: 'geometrie', result: { type: 'Point', coordinates: [7.1, 50.2] }, time: null },
    ],
  }),
];

export const input = (over: Partial<DetailInput> = {}): DetailInput => ({
  typeKey: 'baum',
  type,
  tasks: { kontrolle: { label: { de: 'Kontrolle' } }, erfassen: { label: { de: 'Erfassen' } } } as never,
  row,
  runs,
  names: { u1: 'Anna Beispiel', u2: 'Bernd Beispiel' },
  actors: { system: 'System', importBy: (a) => `Import (${a})` },
  locale: 'de',
  ...over,
});
