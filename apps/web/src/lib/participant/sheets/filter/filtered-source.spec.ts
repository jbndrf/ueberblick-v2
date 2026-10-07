import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import type { FeatureChange, FeatureSource, MapFeature } from '@ueberblick/ui';
import { filteredSource, visibleOf, type ViewPassOf } from './filtered-source';
import { createFilterController } from './filter-controller';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const WORLD = [-180, -90, 180, 90] as const;
const mf = (id: string): MapFeature =>
  ({
    id: id as FeatureId,
    anchor: [0, 0],
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
  }) as MapFeature;
const state = (id: string, type: string, stage?: string): FeatureState =>
  ({
    id,
    type,
    properties: stage === undefined ? {} : { stage },
    lifecycle: 'active',
  }) as unknown as FeatureState;

function setup(viewPassOf?: ViewPassOf) {
  const states = new Map<string, FeatureState>([
    ['1', state('1', 'baum', 'erfasst')],
    ['2', state('2', 'baum', 'erledigt')],
    ['3', state('3', 'flaeche')],
  ]);
  let inner: ((c: FeatureChange) => void) | undefined;
  let queries = 0;
  const source: FeatureSource = {
    query: () => {
      queries += 1;
      return [...states.keys()].map(mf);
    },
    *queryChunks() {
      queries += 1;
      yield [...states.keys()].map(mf);
    },
    subscribe: (_b, l) => {
      inner = l;
      l({ add: [...states.keys()].map(mf), update: [], remove: [] });
      return () => (inner = undefined);
    },
  };
  const controller = createFilterController();
  const wrapped = filteredSource(source, (id) => states.get(id), config, controller, viewPassOf);
  const events: FeatureChange[] = [];
  wrapped.subscribe([...WORLD], (c) => events.push(c));
  const ids = (xs: readonly (MapFeature | FeatureId)[]) =>
    xs.map((x) => (typeof x === 'string' ? x : x.id)) as string[];
  return {
    states,
    wrapped,
    controller,
    events,
    ids,
    queries: () => queries,
    push: (c: FeatureChange) => inner?.(c),
  };
}

describe('filteredSource', () => {
  it('passes everything while nothing is hidden', () => {
    const { wrapped, events, ids } = setup();
    expect(ids(wrapped.query([...WORLD]))).toEqual(['1', '2', '3']);
    expect(ids((events[0] as FeatureChange).add)).toEqual(['1', '2', '3']);
  });

  it('hiding a type removes its features from the map live, and showing it adds them back', () => {
    const { controller, events, ids, wrapped } = setup();
    events.length = 0;
    controller.setType('baum' as Key, false);
    expect(ids((events[0] as FeatureChange).remove).sort()).toEqual(['1', '2']);
    expect(ids(wrapped.query([...WORLD]))).toEqual(['3']);
    events.length = 0;
    controller.setType('baum' as Key, true);
    expect(ids((events[0] as FeatureChange).add).sort()).toEqual(['1', '2']);
  });

  it('hiding a stage removes only features in that stage', () => {
    const { controller, events, ids } = setup();
    events.length = 0;
    controller.setValue('baum' as Key, 'erledigt', false);
    expect(ids((events[0] as FeatureChange).remove)).toEqual(['2']);
  });

  it('a change while hidden is not drawn; a feature moving into a hidden stage is removed', () => {
    const { controller, events, push, states, ids } = setup();
    controller.setValue('baum' as Key, 'erledigt', false);
    events.length = 0;
    push({ add: [], update: [mf('2')], remove: [] });
    expect(events).toEqual([]);
    states.set('1', state('1', 'baum', 'erledigt'));
    push({ add: [], update: [mf('1')], remove: [] });
    expect(ids((events[0] as FeatureChange).remove)).toEqual(['1']);
  });

  it('a toggle costs one query of the view and one event, never a scan per feature', () => {
    const { controller, events, queries } = setup();
    events.length = 0;
    const before = queries();
    controller.setType('flaeche' as Key, false);
    expect(events).toHaveLength(1);
    expect(queries() - before).toBe(1);
  });

  it('a stopped subscription hears nothing more', () => {
    const { wrapped, controller } = setup();
    const heard: FeatureChange[] = [];
    const stop = wrapped.subscribe([...WORLD], (c) => heard.push(c));
    stop();
    heard.length = 0;
    controller.setType('baum' as Key, false);
    expect(heard).toEqual([]);
  });

  it('an active view replaces the switches: they are ignored, and ending it brings them back', () => {
    const only1: ViewPassOf = (v) => (v.key === 'one' ? (st) => st.id === '1' : undefined);
    const { controller, events, ids, wrapped } = setup(only1);
    controller.setType('flaeche' as Key, false); // a switch
    expect(ids(wrapped.query([...WORLD]))).toEqual(['1', '2']);
    events.length = 0;
    controller.setActiveView({ kind: 'preset', key: 'one' });
    expect(ids((events[0] as FeatureChange).remove).sort()).toEqual(['2']);
    expect(ids((events[0] as FeatureChange).add)).toEqual([]);
    controller.setType('baum' as Key, false); // ignored while the view is active
    expect(ids(wrapped.query([...WORLD]))).toEqual(['1']);
    controller.setActiveView(null);
    expect(ids(wrapped.query([...WORLD]))).toEqual([]);
  });

  it('a view that cannot be evaluated leaves the switches in charge', () => {
    const { controller, ids, wrapped } = setup(() => undefined);
    controller.setActiveView({ kind: 'saved', key: 'broken' });
    controller.setType('baum' as Key, false);
    expect(ids(wrapped.query([...WORLD]))).toEqual(['3']);
  });

  it('an edit of the active view (a new revision) evaluates it again and the map follows live', () => {
    let wanted = '1';
    const calls: string[] = [];
    const edited: ViewPassOf = () => {
      calls.push(wanted);
      const id = wanted;
      return (st) => st.id === id;
    };
    const { controller, events, ids, wrapped } = setup(edited);
    controller.setActiveView({ kind: 'saved', key: 'v' });
    expect(ids(wrapped.query([...WORLD]))).toEqual(['1']);
    expect(ids(wrapped.query([...WORLD]))).toEqual(['1']);
    expect(calls).toEqual(['1']); // the pass is kept between calls
    events.length = 0;
    wanted = '2';
    controller.refreshView();
    expect(ids(wrapped.query([...WORLD]))).toEqual(['2']);
    expect(calls).toEqual(['1', '2']);
    // the walk goes in slices (WP-848): the removal and the addition are separate events
    expect(events.flatMap((e) => ids(e.add))).toEqual(['2']);
    expect(events.flatMap((e) => ids(e.remove))).toEqual(['1']);
  });
});

describe("visibleOf (the Liste uses the map's predicate, WP-706)", () => {
  it('follows the controller live and agrees with the filtered source', () => {
    const t = setup();
    const visible = visibleOf((id) => t.states.get(id), config, t.controller);
    expect(['1', '2', '3'].map((id) => visible(id as FeatureId))).toEqual([true, true, true]);
    t.controller.setType('baum' as Key, false);
    expect(['1', '2', '3'].map((id) => visible(id as FeatureId))).toEqual([false, false, true]);
    expect(t.ids(t.wrapped.query([...WORLD]))).toEqual(['3']);
    t.controller.setType('baum' as Key, true);
    expect(visible('1' as FeatureId)).toBe(true);
  });
});
