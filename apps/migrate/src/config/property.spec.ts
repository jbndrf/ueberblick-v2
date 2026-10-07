/**
 * Property test (R9): whatever the v3 configuration, the converted files compile with zero problems
 * and the report accounts for every item. The generator draws field types, clauses of every kind and
 * operator, effects, tasks and rule sets at random, including references to things that do not exist.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convertConfig } from './convert';
import { readProject } from './read';
import { K } from './read-parts';
import { NOT_HANDLED } from './report';
import { V3_FIELD_OPS, V3_FIELD_TYPES, V3_TRIGGER_KINDS } from './registry';

const FIELDS = ['f0', 'f1', 'f2', 'f3'];
const ref = fc.constantFrom(...FIELDS, 'nope').map((k) => `@field/${k}`);
const stage = fc.constantFrom('neu', 'aktiv', 'fertig', 'weg');
const text = fc.constantFrom('a', 'b', '3', '2026-01-01', 'x y', "it's", '');

const clause: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  fc.record({
    kind: fc.constant('field'),
    [K.propId]: ref,
    op: fc.constantFrom(...V3_FIELD_OPS.keys),
    value: text,
  }),
  fc.record({
    kind: fc.constant('field_to_field'),
    [K.propId]: ref,
    op: fc.constantFrom('equals', 'gt', 'contains'),
    [K.otherPropId]: ref,
  }),
  fc.record({
    kind: fc.constant('stage'),
    op: fc.constantFrom('in', 'equals'),
    stage_keys: fc.array(stage, { maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('role'),
    role_ids: fc.array(fc.constantFrom('@role/a', '@role/b', '@role/zz'), { maxLength: 2 }),
  }),
  fc.record({ kind: fc.constant('ownership'), value: fc.constantFrom('self', 'any') }),
  fc.record({
    kind: fc.constant('instance_status'),
    status: fc.constantFrom('active', 'completed', 'archived'),
  }),
  fc.record({ kind: fc.constant('related'), via: ref, quantifier: fc.constantFrom('any', 'all', 'none') }),
  fc.record({ kind: fc.constant('mystery') }),
);

const cond: fc.Arbitrary<unknown> = fc.oneof(
  clause,
  fc.record({ all: fc.array(clause, { minLength: 1, maxLength: 3 }) }),
  fc.record({ any: fc.array(clause, { minLength: 1, maxLength: 3 }) }),
  fc.record({ not: clause }),
);

const effect: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  fc.record({ effect: fc.constant('transition'), to: stage }),
  fc.record({ effect: fc.constant('snapshot') }),
  fc.record({ effect: fc.constant('create_instance') }),
  fc.record({
    effect: fc.constant('create_instance'),
    workflow: fc.constantFrom('@workflow/w', '@workflow/nope'),
  }),
  fc.record({ effect: fc.constant('set_field'), [K.propId]: ref, value: text }),
  fc.record({
    effect: fc.constant('set_field'),
    [K.propId]: ref,
    expression: fc.constantFrom('{f0} + 1', '{f2} > 3', 'round({f0})', '{f1} * {f2}', '{f3} and'),
  }),
  fc.record({ effect: fc.constant('clear_field'), [K.propId]: ref }),
  fc.record({
    effect: fc.constant('set_instance_status'),
    status: fc.constantFrom('active', 'completed', 'archived'),
  }),
  fc.record({
    effect: fc.constant('compute'),
    [K.propId]: ref,
    expression: fc.constantFrom('{f0} * 2', '{f2} < 1'),
  }),
);

const placement = fc.record({
  [K.propId]: ref,
  order: fc.nat(5),
  page: fc.constantFrom(0, 1, 2),
  row: fc.nat(3),
  column: fc.constantFrom('left', 'right', 'full'),
  required: fc.boolean(),
  prefill: fc.oneof(
    fc.constant({ kind: 'empty' }),
    fc.record({ kind: fc.constant('constant'), value: text }),
    fc.constant({ kind: 'last_value' }),
    fc.record({ kind: fc.constant('computed'), expression: fc.constantFrom('{f0} + 1', 'min({f0}, 2)') }),
  ),
  force_dirty: fc.boolean(),
  conditional_logic: fc.option(fc.record({ show_if: cond }), { nil: undefined }),
});

const step = fc.record({
  key: fc.constant('s'),
  kind: fc.constantFrom('form', 'quick_edit', 'automation'), // glossary-lint-ignore
  mode: fc.constantFrom('fields', 'location'),
  field_refs: fc.array(placement, { maxLength: 4 }),
});

const task = fc.record({
  key: fc.constant('t'),
  name: fc.constant('T'),
  entry: fc.boolean(),
  activation: fc.oneof(
    fc.constant({ mode: 'available' }),
    fc.record({
      mode: fc.constant('triggered'),
      trigger_type: fc.constantFrom('on_transition', 'on_field_change', 'scheduled'),
      trigger_config: fc.record({
        from_stage_id: stage,
        to_stage_id: stage,
        field_key: ref,
        cron: fc.constant('0 * * * *'),
      }),
    }),
  ),
  conditions: fc.array(cond, { maxLength: 3 }),
  tools: fc.array(step, { maxLength: 2 }),
  effects: fc.array(effect, { maxLength: 4 }),
});

const trigger = fc.oneof(
  ...V3_TRIGGER_KINDS.keys.map((type) =>
    fc.record({
      type: fc.constant(type),
      from_stage_key: stage,
      to_stage_key: stage,
      [K.propIds]: fc.array(ref, { maxLength: 2 }),
      in_stage_key: stage,
      cron: fc.constant('0 2 * * *'),
      after: fc.constant('7d'),
      since: fc.constant('created'),
      conditions: fc.array(clause, { maxLength: 2 }),
      task_key: fc.constantFrom('t', 'nope'),
    }),
  ),
);

const ruleSet = fc.record({
  key: fc.constant('r'),
  name: fc.constant('R'),
  trigger,
  execution_mode: fc.constantFrom('run_all', 'first_match'),
  steps: fc.array(
    fc.record({
      name: fc.constant('S'),
      when: fc.array(cond, { maxLength: 2 }),
      do: fc.array(effect, { maxLength: 3 }),
    }),
    { maxLength: 3 },
  ),
});

const field = (i: number) =>
  fc.record({
    field_label: fc.constant(`Feld ${i}`),
    field_type: fc.constantFrom(...V3_FIELD_TYPES.keys),
    write_mode: fc.constantFrom('singleton', 'observation', 'computed'),
    field_options: fc.record({
      options: fc.array(fc.constantFrom('a', 'b', '3', 'x y', 'a'), { maxLength: 4 }),
      source_type: fc.constantFrom('custom_table', 'participants', 'roles'),
      custom_table_id: fc.constantFrom('@table/t', '@table/nope'),
      target_workflow_id: fc.constantFrom('@workflow/w', '@workflow/nope'),
      date_mode: fc.constantFrom('date', 'datetime', 'time'),
      multiplicity: fc.constantFrom('single', 'many'),
    }),
    validation_rules: fc.record(
      { min: fc.integer(), max: fc.integer(), minLength: fc.nat(5), pattern: fc.constant('^a') },
      { requiredKeys: [] },
    ),
  });

const project = fc
  .record({
    fields: fc.tuple(field(0), field(1), field(2), field(3)),
    tasks: fc.array(task, { maxLength: 3 }),
    rules: fc.array(ruleSet, { maxLength: 2 }),
    priv: fc.boolean(),
    stages: fc.array(fc.constantFrom('neu', 'aktiv', 'fertig'), { maxLength: 3 }).map((s) => [...new Set(s)]),
    geometry: fc.constantFrom('point', 'line', 'polygon', 'none'),
  })
  .map((p) => ({
    format: 1,
    version: 0,
    source: { name: 'Zufall', description: '' },
    settings: {},
    roles: [
      { key: 'a', record: { name: 'A' } },
      { key: 'b', record: { name: 'B' } },
    ],
    custom_tables: [
      { key: 't', record: { name: 'T' }, columns: [{ column_name: 'n', column_type: 'text' }] },
    ],
    map_layers: [],
    info_pages: [],
    workflows: [
      {
        key: 'w',
        record: { name: 'W', geometry_type: p.geometry, private_instances: p.priv },
        [K.props]: p.fields.map((rec, i) => ({ key: FIELDS[i], record: rec })),
        document: {
          version: 0,
          stages: p.stages.map((k, i) => ({ key: k, name: k, type: i === 0 ? 'start' : 'intermediate' })),
          edges: [],
          tasks: p.tasks.map((t, i) => ({ ...t, key: `t${i === 0 ? '' : i}` })),
          [K.rules]: p.rules.map((r, i) => ({ ...r, key: `r${i}` })),
        },
      },
    ],
  }));

describe('convertConfig (property)', () => {
  it('always gives files that compile with zero problems, and a complete report', () => {
    fc.assert(
      fc.property(project, (v3) => {
        const r = convertConfig(v3);
        expect(r.check.schemaIssues).toEqual([]);
        expect(r.check.problems).toEqual([]);
        expect(r.report.items.map((i) => i.id)).toEqual(readProject(v3).inventory);
        expect(r.report.stray).toEqual([]);
        expect(r.report.items.filter((i) => i.reason === NOT_HANDLED)).toEqual([]);
        expect(r.report.items.filter((i) => i.status !== 'mapped' && i.reason === '')).toEqual([]);
      }),
      { numRuns: Number(process.env['FC_RUNS'] ?? 400) },
    );
  }, 120_000);
});
