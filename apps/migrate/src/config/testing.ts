/** Test support: the synthetic v3 fixtures, and a generator for large synthetic projects. Not used at run time. */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { K } from './read-parts';

export const FIXTURES = ['baumkontrolle', 'meldungen', 'minimal'] as const;

/** A synthetic v3 export from `fixtures/v3-synthetic/config/<name>.yaml`. */
export function loadFixture(name: string): unknown {
  const url = new URL(`../../../../fixtures/v3-synthetic/config/${name}.yaml`, import.meta.url);
  return parse(readFileSync(url, 'utf8')) as unknown;
}

type Rec = Record<string, unknown>;

/**
 * A large synthetic v3 project: `types` workflows with `fields` fields each, an entry task, a
 * checking task with conditions and effects, and a rule set per workflow. Deterministic.
 */
export function syntheticProject(types: number, fields: number): unknown {
  const kinds = ['short_text', 'long_text', 'number', 'date', 'dropdown', 'multiple_choice'];
  const workflows: Rec[] = [];
  for (let w = 0; w < types; w++) {
    const fieldRecords: Rec[] = [];
    for (let f = 0; f < fields; f++) {
      const kind = kinds[f % kinds.length] as string;
      fieldRecords.push({
        key: `f${f}`,
        record: {
          field_label: `Feld ${f}`,
          field_type: kind,
          ...(kind === 'dropdown' || kind === 'multiple_choice'
            ? { field_options: { options: ['a', 'b', 'c', 'd'] } }
            : {}),
        },
      });
    }
    const refs = (n: number): Rec[] =>
      Array.from({ length: Math.min(n, fields) }, (_, i) => ({
        [K.propId]: `@field/f${i}`,
        order: i,
        page: 1,
        row: i,
        column: 'full',
        required: i === 0,
        prefill: { kind: 'empty' },
        force_dirty: false,
      }));
    workflows.push({
      key: `typ${w}`,
      record: { name: `Typ ${w}`, workflow_type: 'incident', geometry_type: 'point', sort_order: w },
      [K.props]: fieldRecords,
      document: {
        version: 0,
        stages: [
          { key: 'neu', name: 'Neu', type: 'start' },
          { key: 'aktiv', name: 'Aktiv', type: 'intermediate' },
          { key: 'fertig', name: 'Fertig', type: 'end' },
        ],
        edges: [{ from_stage_key: 'neu', to_stage_key: 'aktiv' }],
        tasks: [
          {
            key: 'neu',
            name: 'Neu',
            entry: true,
            activation: { mode: 'available' },
            conditions: [{ kind: 'role', role_ids: ['@role/a'] }],
            tools: [{ key: 't', kind: 'form', field_refs: refs(6) }],
            effects: [{ effect: 'create_instance' }],
          },
          ...Array.from({ length: 4 }, (_, t) => ({
            key: `pruefen${t}`,
            name: `Prüfen ${t}`,
            activation: { mode: 'available' },
            conditions: [
              { kind: 'role', role_ids: ['@role/a', '@role/b'] },
              { kind: 'stage', op: 'in', stage_keys: ['neu', 'aktiv'] },
              { kind: 'field', [K.propId]: '@field/f2', op: 'gt', value: '3' },
            ],
            tools: [{ key: 't', kind: 'form', field_refs: refs(8) }],
            effects: [
              { effect: 'set_field', [K.propId]: '@field/f0', value: 'ok' },
              { effect: 'transition', to: 'aktiv' },
            ],
          })),
        ],
        [K.rules]: [
          {
            key: 'regel',
            name: 'Regel',
            trigger: { type: 'on_field_change', [K.propIds]: ['@field/f2'] },
            steps: [
              {
                name: 'Schritt',
                when: [{ kind: 'field', [K.propId]: '@field/f2', op: 'gt', value: '10' }],
                do: [{ effect: 'transition', to: 'fertig' }],
              },
            ],
          },
        ],
      },
    });
  }
  return {
    format: 1,
    version: 0,
    source: { name: `Gross ${types}`, description: '' },
    settings: {},
    roles: [
      { key: 'a', record: { name: 'A' } },
      { key: 'b', record: { name: 'B' } },
    ],
    custom_tables: [],
    map_layers: [],
    info_pages: [],
    workflows,
  };
}
