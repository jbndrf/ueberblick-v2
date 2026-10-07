// WP-687: which tasks edit the location and so go straight onto the map (v3 `handleTaskInvoke` :583-606).
import { describe, expect, it } from 'vitest';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { placingOf } from './location-edit';

const file = {
  types: {
    baum: {
      properties: {
        lage: { type: 'geometry', geometry_type: 'point' },
        befund: { type: 'text' },
      },
    },
  },
  tasks: {
    verschieben: { on: 'baum', form: { lage: { tool: 'draw', required: true } } },
    verschieben_mit: { on: 'baum', form: { lage: { tool: 'draw' }, befund: {} } },
    nur_ort: { on: 'baum', steps: [{ kind: 'location', property: 'lage' }] },
    bearbeiten: {
      on: 'baum',
      steps: [
        { kind: 'quick_edit', properties: ['befund'] },
        { kind: 'location', property: 'lage' },
      ],
    },
    befund: { on: 'baum', form: { befund: {} } },
    knopf: { on: 'baum' },
  },
} as unknown as CompiledConfig['file'];

describe('placingOf', () => {
  it('a form whose only field is the geometry places it', () =>
    expect(placingOf(file, 'verschieben')).toEqual({ property: 'lage', alone: true }));
  it('a task whose only step is a location step places it', () =>
    expect(placingOf(file, 'nur_ort')).toEqual({ property: 'lage', alone: true }));
  it('a geometry field among others places first, then the form follows', () =>
    expect(placingOf(file, 'verschieben_mit')).toEqual({ property: 'lage', alone: false }));
  it('a location step among several steps stays a step of the flow', () =>
    expect(placingOf(file, 'bearbeiten')).toBeUndefined());
  it('a form without a geometry field and a task without a form place nothing', () => {
    expect(placingOf(file, 'befund')).toBeUndefined();
    expect(placingOf(file, 'knopf')).toBeUndefined();
    expect(placingOf(file, 'gibtsnicht')).toBeUndefined();
  });
});
