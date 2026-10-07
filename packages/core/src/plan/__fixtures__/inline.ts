/** A hand-made project for the corners the golden corpus does not reach: rule chains, change triggers, create permission. */
import type { CompiledConfig } from '../../schema/compile/contract';
import { build } from './world';

/** Refusal codes that plan-inline.spec proves (plan.spec proves the rest on the golden project). */
export const INLINE_COVERED = [
  'not_permitted',
  'geometry_required',
  'depth_exceeded',
  'quota_exceeded',
  'too_many_targets', // then-of.spec.ts
] as const;

export const inlineFile = (limit: number): Record<string, unknown> => ({
  schema: 'ueberblick/1',
  template: { key: 'inline', version: '1.0.0' },
  inputs: { limit: { type: 'integer', default: limit } },
  roles: { maker: { label: 'Maker' }, viewer: { label: 'Viewer' } },
  types: {
    zone: {
      label: 'Zone',
      geometry: 'area',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { area: { type: 'geometry', geometry_type: 'polygon' }, kind: { type: 'text' } },
    },
    item: {
      label: 'Item',
      geometry: 'geom',
      permissions: { see: '$all', create: ['maker'], write: '$all' },
      properties: {
        geom: { type: 'geometry', geometry_type: 'point', required: true },
        label: { type: 'text', required: true },
        n: { type: 'number', default: 0 },
        kind: { type: 'text' },
      },
      relations: {
        zone: { to: 'zone', derive: 'within(self.geom, other.area)', cardinality: 'one' },
        same: {
          to: 'zone',
          derive: 'within(self.geom, other.area) && self.kind == other.kind',
          cardinality: 'one',
        },
      },
    },
    secret: {
      label: 'Secret',
      permissions: { see: ['maker'], create: '$all', write: ['maker'] },
      properties: { note: { type: 'text' } },
    },
    guarded: {
      label: 'Guarded',
      permissions: { see: '$all', create: '$all', write: ['maker'] },
      properties: { note: { type: 'text' } },
    },
    log: {
      label: 'Log',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { item: { type: 'reference', to: 'item' }, note: { type: 'text', required: true } },
    },
  },
  tasks: {
    add: { label: 'Add', on: '$map', creates: 'item', form: { geom: {}, label: {}, kind: {} } },
    add_zone: { label: 'Add zone', on: '$map', creates: 'zone', form: { area: {}, kind: {} } },
    bump: {
      label: 'Bump',
      on: 'item',
      then: [{ set: { n: 'self.n + 1' } }],
      auto: { again: { after: 'bump', when: 'self.n < inputs.limit' } },
    },
    only_x: { label: 'Only x', on: 'item', when: "actor.id == 'x'" },
    in_zone: {
      label: 'In zone',
      on: 'item',
      bind: { z: 'self.zone' },
      then: [{ set: { label: "'zoned'" } }],
    },
    in_same: {
      label: 'In same',
      on: 'item',
      bind: { z: 'self.same' },
      then: [{ set: { label: "'same'" } }],
    },
    set_kind: { label: 'Set kind', on: 'item', form: { kind: { required: true } } },
    touch_secret: { label: 'Touch', on: 'secret', form: { note: {} } },
    edit_guarded: { label: 'Edit', on: 'guarded', form: { note: {} } },
    poke: { label: 'Poke', on: 'item' },
    noop: { label: 'Noop', on: 'item' },
    ping: { label: 'Ping', on: 'item' },
    move: { label: 'Move', on: 'item', form: { geom: {} } },
    move_zone: { label: 'Move zone', on: 'zone', form: { area: {} } },
    needs_note: {
      label: 'Needs note',
      on: '$none',
      creates: 'log',
      form: { note: { required: true } },
      then: [{ set: { note: 'form.note' } }],
      auto: { poke_rule: { after: 'poke' } },
    },
    log_change: {
      label: 'Log',
      on: 'item',
      creates: 'log',
      form: { item: {}, note: {} },
      then: [{ set: { item: 'self', note: 'self.label' } }],
      auto: { on_label: { change: 'item.label' } },
    },
  },
});

export const inline = (limit = 3): CompiledConfig => build(inlineFile(limit));
