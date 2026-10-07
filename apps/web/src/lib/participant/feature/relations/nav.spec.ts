// The relation navigation (v3 `relation-graph.ts`): chains, children per relation, open work and the create offer.
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { MAX_CHAINS, MAX_DEPTH, createRelationNav, hierarchyGroups } from './nav';
import { FILE, deps, world, type Node } from './fixtures';

const f = (s: string): FeatureId => s as FeatureId;

const WORLD: Record<string, Node> = {
  g1: { type: 'gebiet', label: 'Nord' },
  b1: {
    type: 'baum',
    label: 'Eiche',
    stage: 'neu',
    parents: [['gebiet', 'g1']],
    tasks: ['massnahme_anlegen'],
  },
  b2: { type: 'baum', label: 'Linde', stage: 'fertig', parents: [['gebiet', 'g1']] },
  m1: {
    type: 'massnahme',
    label: 'Schnitt',
    stage: 'offen',
    parents: [['baum', 'b1']],
    tasks: ['massnahme_erledigen', 'kommentar'],
  },
};

describe('parent chains', () => {
  it('walks the edges that leave a feature, root first', () => {
    const nav = createRelationNav(deps(world(WORLD).source));
    expect(nav.chains(f('m1'))).toEqual([
      [
        { parent: 'g1', group: 'baum.gebiet' },
        { parent: 'b1', group: 'massnahme.baum' },
      ],
    ]);
    expect(nav.chains(f('g1'))).toEqual([]);
  });

  it('a feature with several parents has one chain per parent route', () => {
    const nav = createRelationNav(
      deps(
        world({
          ...WORLD,
          g2: { type: 'gebiet', label: 'Süd' },
          b1: {
            ...(WORLD['b1'] as Node),
            parents: [
              ['gebiet', 'g1'],
              ['gebiet', 'g2'],
            ],
          },
        }).source,
      ),
    );
    expect(nav.chains(f('b1')).map((c) => c.map((h) => h.parent))).toEqual([['g1'], ['g2']]);
  });

  it('survives a cycle and caps the depth and the number of chains', () => {
    const loop = createRelationNav(
      deps(
        world({
          a: { type: 'baum', parents: [['gebiet', 'b']] },
          b: { type: 'baum', parents: [['gebiet', 'a']] },
        }).source,
      ),
    );
    expect(loop.chains(f('a'))).toEqual([[{ parent: 'b', group: 'baum.gebiet' }]]);

    const deep: Record<string, Node> = {};
    for (let i = 0; i < 30; i++) deep[`n${i}`] = { type: 'baum', parents: [['gebiet', `n${i + 1}`]] };
    const chain = createRelationNav(deps(world(deep).source)).chains(f('n0'));
    expect(chain).toHaveLength(1);
    expect(chain[0]).toHaveLength(MAX_DEPTH);

    const wide: Record<string, Node> = { c: { type: 'baum', parents: [] } };
    const parents: [string, string][] = [];
    for (let i = 0; i < 20; i++) {
      wide[`p${i}`] = { type: 'gebiet' };
      parents.push(['gebiet', `p${i}`]);
    }
    wide['c'] = { type: 'baum', parents };
    expect(createRelationNav(deps(world(wide).source)).chains(f('c'))).toHaveLength(MAX_CHAINS);
  });
});

describe('which edges are parents', () => {
  it('a plain lookup and a derived edge no parent declares are not in the path', () => {
    const nav = createRelationNav(
      deps(
        world({
          ba: { type: 'baumart', label: 'Eiche' },
          g1: { type: 'gebiet' },
          b1: {
            type: 'baum',
            parents: [
              ['art', 'ba'],
              ['gebiet', 'g1'],
              ['intersects', 'g1', true],
            ],
          },
        }).source,
      ),
    );
    expect(nav.chains(f('b1'))).toEqual([[{ parent: 'g1', group: 'baum.gebiet' }]]);
    // and the species does not list the tree as a child
    expect(nav.groups(f('ba'))).toEqual([]);
  });

  it('is a pure function of the config, computed once per config', () => {
    expect([...hierarchyGroups(FILE)].sort()).toEqual(['baum.gebiet', 'baum.randlage', 'massnahme.baum']);
    expect(hierarchyGroups(FILE)).toBe(hierarchyGroups(FILE));
  });
});

describe('children per relation', () => {
  const nav = createRelationNav(deps(world(WORLD).source));

  it('groups the features that point here, named by the declared inverse relation', () => {
    expect(nav.children(f('g1'), 'baum.gebiet')).toEqual(['b1', 'b2']);
    expect(nav.groupName(f('g1'), 'baum.gebiet')).toBe('Bäume');
    expect(nav.groups(f('g1'))).toMatchObject([
      { key: 'baum.gebiet', name: 'Bäume', count: 2, create: undefined },
    ]);
  });

  it('without a declared inverse the group carries the child type name', () => {
    expect(nav.groupName(f('b1'), 'massnahme.baum')).toBe('Maßnahme');
  });

  it('a create task that links to self offers a group with no child yet, and is the create offer', () => {
    const lonely = createRelationNav(
      deps(world({ b1: { type: 'baum', stage: 'neu', tasks: ['massnahme_anlegen'] } }).source),
    );
    expect(lonely.groups(f('b1'))).toEqual([
      {
        key: 'massnahme.baum',
        name: 'Maßnahme',
        count: 0,
        create: { task: 'massnahme_anlegen', name: 'Maßnahme' },
      },
    ]);
    expect(lonely.createTasks(f('b1'))).toEqual(new Set(['massnahme_anlegen']));
  });

  it('the create offer stays once a child exists (v3 RelationList.svelte:43 offers it for any child count)', () => {
    const nav = createRelationNav(deps(world(WORLD).source));
    const group = nav.groups(f('b1')).find((g) => g.key === 'massnahme.baum');
    expect(group?.count).toBe(1);
    expect(group?.create).toEqual({ task: 'massnahme_anlegen', name: 'Maßnahme' });
    expect(nav.offer(f('b1'), 'massnahme.baum')).toEqual({ task: 'massnahme_anlegen', name: 'Maßnahme' });
  });

  it('a create task not available here offers nothing', () => {
    const without = createRelationNav(
      deps(world({ ...WORLD, b1: { ...(WORLD['b1'] as Node), tasks: [] } }).source),
    );
    expect(without.groups(f('b1'))).toMatchObject([{ key: 'massnahme.baum', count: 1, create: undefined }]);
    expect(without.createTasks(f('b1')).size).toBe(0);
  });

  it('two groups with one name say which relation they are', () => {
    const two = createRelationNav(
      deps(
        world({
          g1: { type: 'gebiet' },
          b1: {
            type: 'baum',
            parents: [
              ['gebiet', 'g1'],
              ['randlage', 'g1', true],
            ],
          },
        }).source,
      ),
    );
    const names = two.groups(f('g1')).map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('summarises a feature for a row: label, type, stage in words, time', () => {
    expect(nav.summary(f('b1'))).toMatchObject({ label: 'Eiche', typeLabel: 'Baum', stageName: 'Neu' });
    expect(nav.summary(f('zzz'))).toBeUndefined();
  });
});

describe('open work', () => {
  it('a task that writes the stage is open work; a plain form task is not', () => {
    const nav = createRelationNav(deps(world(WORLD).source));
    expect(nav.leadsToOpenWork(f('m1'))).toBe(true);
    const plain = createRelationNav(
      deps(world({ m1: { ...(WORLD['m1'] as Node), tasks: ['kommentar'] } }).source),
    );
    expect(plain.leadsToOpenWork(f('m1'))).toBe(false);
  });

  it('a task that advances a bound feature counts too (set "baum.stage")', () => {
    const nav = createRelationNav(
      deps(world({ m1: { ...(WORLD['m1'] as Node), tasks: ['baum_fertig'] } }).source),
    );
    expect(nav.leadsToOpenWork(f('m1'))).toBe(true);
  });

  it('leads through descendants: the tree leads to open work through its measure, the area too', () => {
    const nav = createRelationNav(deps(world(WORLD).source));
    expect(nav.leadsToOpenWork(f('b1'))).toBe(true);
    expect(nav.openWork(f('g1'), 'baum.gebiet')).toBe(1);
    expect(nav.openWork(f('g1'))).toBe(1);
    expect(nav.openWork(f('b2'))).toBe(0);
  });

  it('a finished feature has none, even with a stage task available (v3 end-stage rule)', () => {
    const nav = createRelationNav(
      deps(world({ m1: { ...(WORLD['m1'] as Node), stage: 'erledigt' } }).source),
    );
    expect(nav.isFinished(f('m1'))).toBe(true);
    expect(nav.leadsToOpenWork(f('m1'))).toBe(false);
    const archived = createRelationNav(
      deps(world({ m1: { ...(WORLD['m1'] as Node), lifecycle: 'completed' } }).source),
    );
    expect(archived.isFinished(f('m1'))).toBe(true);
  });

  it('a cycle terminates', () => {
    const nav = createRelationNav(
      deps(
        world({
          a: { type: 'baum', parents: [['gebiet', 'b']] },
          b: { type: 'baum', parents: [['gebiet', 'a']] },
        }).source,
      ),
    );
    expect(nav.leadsToOpenWork(f('a'))).toBe(false);
  });
});

describe('reads (R14)', () => {
  it('a path and a menu read only the features near this one, each once', () => {
    const many: Record<string, Node> = { g: { type: 'gebiet' } };
    for (let i = 0; i < 500; i++) many[`k${i}`] = { type: 'baum', stage: 'neu', parents: [['gebiet', 'g']] };
    many['x'] = { type: 'baum', parents: [['gebiet', 'g']] };
    const { source, reads } = world(many);
    const nav = createRelationNav(deps(source));
    nav.chains(f('x'));
    nav.groups(f('g'));
    // x and g only: the 500 siblings are never read until a count asks for them
    expect(reads.input).toBe(2);
    nav.groups(f('g'));
    expect(reads.input).toBe(2);
  });
});

describe('WP-723: the live language reaches the reader', () => {
  it('a label the reader names in the language of the nav changes with the language, without a reload', () => {
    const { source } = world(WORLD);
    const live = {
      ...source,
      sheetInput: (id: FeatureId, locale?: string) => {
        const input = source.sheetInput(id);
        if (input === undefined) return undefined;
        return {
          ...input,
          lookups: {
            ...input.lookups,
            feature: () => ({ label: `${id}@${locale}`, type: input.feature.type }),
          },
        };
      },
    };
    const label = (locale: 'de' | 'en') =>
      createRelationNav({ ...deps(live), locale }).summary(f('b1'))?.label;
    expect(label('en')).toBe('b1@en');
    expect(label('de')).toBe('b1@de');
  });
});
