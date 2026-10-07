import { describe, expect, it } from 'vitest';
import { barItems, fabRotation, nextFab } from './bar';

describe('the bottom bar', () => {
  it('has v3 order: Layer, Filter, +, Standort, Werkzeuge, Einstellungen', () => {
    expect(barItems({ toolsActive: true })).toEqual([
      'layers',
      'filter',
      'create',
      'location',
      'tools',
      'settings',
    ]);
  });

  it('hides Werkzeuge while no tool is active', () => {
    expect(barItems({ toolsActive: false })).toEqual(['layers', 'filter', 'create', 'location', 'settings']);
  });

  it('the + cycles through three steps and turns like v3', () => {
    expect([nextFab(0), nextFab(1), nextFab(2)]).toEqual([1, 2, 0]);
    expect([0, 1, 2].map(fabRotation)).toEqual([0, 45, 90]);
  });
});
