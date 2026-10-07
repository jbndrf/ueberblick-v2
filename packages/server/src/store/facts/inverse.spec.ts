// Two feature types that store edges under the same relation key must not mix in an inverse read (WP-104.1 follow-up).
import { describe, expect, it } from 'vitest';
import { openProjectDb } from '../../db/open';
import type { InverseRelations } from '../contract';
import { inverseRelations } from '../run/inverse';
import { createFacts } from './index';
import { build } from '../run/testkit';
import { fid, k } from './sqlite.testkit';

describe('inverse relations keyed by (source type, key)', () => {
  it('a plot lists only the trees, not the shrubs that reference it under the same key', () => {
    const db = openProjectDb(':memory:', 'test');
    const put = db.prepare(
      'INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, ?, 1, ?, 1)',
    );
    for (const [id, type] of [
      ['p0', 'plot'],
      ['t0', 'tree'],
      ['t1', 'tree'],
      ['s0', 'shrub'],
    ] as const)
      put.run(id, type, '{}');
    const edge = db.prepare(
      "INSERT INTO edges (from_id, relation, to_id, derived, updated_seq) VALUES (?, 'plot', 'p0', 0, 1)",
    );
    for (const from of ['t0', 't1', 's0']) edge.run(from);
    const inverse: InverseRelations = new Map([
      ['plot.trees', { key: 'plot', from: 'tree' }],
      ['plot.shrubs', { key: 'plot', from: 'shrub' }],
    ]);
    const facts = createFacts(db, inverse);
    expect(facts.related(fid('p0'), k('trees'))).toEqual(['t0', 't1']);
    expect(facts.related(fid('p0'), k('shrubs'))).toEqual(['s0']);
  });

  it('inverseRelations(config) reads inverse_of as <source type>.<stored key>', () => {
    const config = build({
      schema: 'ueberblick/1',
      template: { key: 'x', version: '1.0.0' },
      types: {
        plot: {
          label: 'Plot',
          properties: {},
          relations: {
            trees: { to: 'tree', inverse_of: 'tree.plot', cardinality: 'many' },
            shrubs: { to: 'shrub', inverse_of: 'shrub.plot', cardinality: 'many' },
          },
        },
        tree: { label: 'Tree', properties: { plot: { type: 'reference', to: 'plot' } } },
        shrub: { label: 'Shrub', properties: { plot: { type: 'reference', to: 'plot' } } },
      },
    } as never);
    expect(inverseRelations(config).get('plot.trees')).toEqual({ key: 'plot', from: 'tree' });
    expect(inverseRelations(config).get('plot.shrubs')).toEqual({ key: 'plot', from: 'shrub' });
  });
});
