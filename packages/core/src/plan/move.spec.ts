// WP-307: the built-in `$move` task. Option moves, multiselect replace, property moves, idempotence, system actor only.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, FeatureId, Json, Key, Observation, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { World, anna, actor, build, fid, ports, rid } from './__fixtures__/world';

const file = {
  schema: 'ueberblick/1',
  template: { key: 'move', version: '1.0.0' },
  roles: { maker: { label: 'Maker' } },
  types: {
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        stage: { type: 'select', options: { erfasst: 'Erfasst', geprueft: 'Geprüft' } },
        tags: { type: 'multiselect', options: { a: 'A', b: 'B', c: 'C' } },
        notiz: { type: 'text' },
        bemerkung: { type: 'text' },
        zaehler: { type: 'number' },
      },
    },
  },
};

const SYSTEM: Actor = actor('system', 'system');
const planApi = createPlan(formApi);
let n = 0;

function setup(props: Record<string, Json>) {
  const config = build(file);
  const world = new World(config);
  const id = world.add(fid(1), 'baum', props);
  return { config, world, id, perms: compilePerms(config) };
}

const move = (id: FeatureId, input: Record<string, Json>, who: Actor = SYSTEM): Run => ({
  id: rid(++n),
  task: '$move' as Key,
  actor: who,
  configVersion: 1,
  featureId: id,
  input,
});

const observations = (r: PlanResult): readonly Observation[] => {
  if (!r.ok) throw new Error(`refused: ${r.refusal.code} ${r.refusal.message}`);
  return r.runs.flatMap((p) => p.observations);
};

function apply(s: ReturnType<typeof setup>, input: Record<string, Json>): readonly Observation[] {
  const r = planApi.planFor([move(s.id, input)], oneVersion(s.config, s.perms), ports(s.world));
  const obs = observations(r);
  if (obs.length > 0) s.world.append(rid(++n), obs);
  return obs;
}

describe('$move', () => {
  it('moves a select value from one option to another', () => {
    const s = setup({ stage: 'erfasst' });
    const obs = apply(s, { property: 'stage', from: 'erfasst', to: 'geprueft' });
    expect(obs).toEqual([{ featureId: s.id, property: 'stage', result: 'geprueft' }]);
    expect(s.world.feature(s.id)?.properties['stage']).toBe('geprueft');
  });

  it('moves an archived feature, not a deleted one (registry flag keepsValues)', () => {
    const a = setup({ stage: 'erfasst' });
    a.world.append(rid(++n), [{ featureId: a.id, property: '$lifecycle', result: 'archived' }]);
    expect(apply(a, { property: 'stage', from: 'erfasst', to: 'geprueft' })).toHaveLength(1);
    expect(a.world.feature(a.id)?.properties['stage']).toBe('geprueft');
    const d = setup({ stage: 'erfasst' });
    d.world.append(rid(++n), [{ featureId: d.id, property: '$lifecycle', result: 'deleted' }]);
    expect(apply(d, { property: 'stage', from: 'erfasst', to: 'geprueft' })).toEqual([]);
    expect(d.world.feature(d.id)?.properties['stage']).toBe('erfasst');
  });

  it('replaces the option inside a multiselect without a duplicate', () => {
    const s = setup({ tags: ['a', 'b', 'c'] });
    apply(s, { property: 'tags', from: 'a', to: 'b' });
    expect(s.world.feature(s.id)?.properties['tags']).toEqual(['b', 'c']);
    const t = setup({ tags: ['a', 'c'] });
    apply(t, { property: 'tags', from: 'a', to: 'b' });
    expect(t.world.feature(t.id)?.properties['tags']).toEqual(['b', 'c']);
  });

  it('moves the value of a property to another property', () => {
    const s = setup({ notiz: 'Wurzel' });
    const obs = apply(s, { property: 'notiz', to_property: 'bemerkung' });
    expect(obs).toEqual([{ featureId: s.id, property: 'bemerkung', result: 'Wurzel' }]);
    expect(s.world.feature(s.id)?.properties['bemerkung']).toBe('Wurzel');
  });

  it('keeps a value already written to the new property', () => {
    const s = setup({ notiz: 'alt', bemerkung: 'neu' });
    expect(apply(s, { property: 'notiz', to_property: 'bemerkung' })).toEqual([]);
  });

  it('is a no-op, and accepted, for a feature without the from value', () => {
    const s = setup({ stage: 'geprueft', tags: ['b'] });
    const r = planApi.planFor(
      [move(s.id, { property: 'stage', from: 'erfasst', to: 'geprueft' })],
      oneVersion(s.config, s.perms),
      ports(s.world),
    );
    expect(r.ok && r.runs).toHaveLength(1);
    expect(observations(r)).toEqual([]);
    expect(apply(s, { property: 'tags', from: 'a', to: 'c' })).toEqual([]);
    expect(apply(s, { property: 'notiz', to_property: 'bemerkung' })).toEqual([]);
  });

  it('refuses every actor that is not the system', () => {
    const s = setup({ stage: 'erfasst' });
    for (const who of [anna, actor('admin', 'root'), actor('import', 'csv')]) {
      const r = planApi.planFor(
        [move(s.id, { property: 'stage', from: 'erfasst', to: 'geprueft' }, who)],
        oneVersion(s.config, s.perms),
        ports(s.world),
      );
      expect(!r.ok && r.refusal.code).toBe('not_permitted');
    }
  });

  it('refuses a missing feature and a malformed or unknown input', () => {
    const s = setup({ stage: 'erfasst' });
    const code = (r: Run) => {
      const out = planApi.planFor([r], oneVersion(s.config, s.perms), ports(s.world));
      return out.ok ? 'ok' : out.refusal.code;
    };
    expect(code(move(fid(99), { property: 'stage', from: 'erfasst', to: 'geprueft' }))).toBe(
      'unknown_feature',
    );
    expect(code(move(s.id, { property: 'stage' }))).toBe('invalid_input');
    expect(code(move(s.id, { property: 'gibtsnicht', from: 'a', to: 'b' }))).toBe('invalid_input');
    expect(code(move(s.id, { property: 'stage', from: 'erfasst', to: 'unbekannt' }))).toBe('invalid_input');
    expect(code(move(s.id, { property: 'notiz', to_property: 'gibtsnicht' }))).toBe('invalid_input');
    expect(code(move(s.id, { property: 'zaehler', from: 1, to: 2 }))).toBe('invalid_input');
  });

  it('property: applying a move twice equals applying it once', () => {
    const options = ['erfasst', 'geprueft'] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...options),
        fc.subarray(['a', 'b', 'c'], { minLength: 0 }),
        fc.constantFrom('a', 'b', 'c'),
        fc.constantFrom('a', 'b', 'c'),
        (stage, tags, from, to) => {
          const s = setup({ stage, tags });
          const inputs: Record<string, Json>[] = [
            { property: 'stage', from: 'erfasst', to: 'geprueft' },
            { property: 'tags', from, to },
          ];
          for (const input of inputs) {
            apply(s, input);
            const once = JSON.stringify(s.world.feature(s.id)?.properties);
            expect(apply(s, input)).toEqual([]);
            expect(JSON.stringify(s.world.feature(s.id)?.properties)).toBe(once);
          }
        },
      ),
    );
  });
});
