// WP-680 (v3 +page.svelte:2321-2359): after a create the new feature's detail opens, its type is made visible if the
// participant had hidden it, and a pending parent link is cleared. Other filters and an active view stay.
import { describe, expect, it, vi } from 'vitest';
import type { FeatureId, Key } from '@ueberblick/core/model';
import { createFilterController } from '../sheets/filter/filter-controller';
import { afterCreate } from './after-create';

const baum = 'baum' as Key;
const flaeche = 'flaeche' as Key;
const id = 'f1' as FeatureId;

describe('afterCreate', () => {
  it('opens the new feature', () => {
    const openFeature = vi.fn();
    afterCreate({ id, type: baum, filter: createFilterController(), openFeature });
    expect(openFeature).toHaveBeenCalledWith(id);
  });

  it('shows a hidden type, and only that type', () => {
    const filter = createFilterController();
    filter.setType(baum, false, ['erfasst']);
    filter.setType(flaeche, false);
    afterCreate({ id, type: baum, filter, openFeature: vi.fn() });
    expect(filter.state().hiddenTypes.has(baum)).toBe(false);
    expect(filter.state().hiddenTypes.has(flaeche)).toBe(true);
    // only the flag: the participant's hidden stages survive (v3 :2352-2354 vs :1964-1982)
    expect(filter.state().hiddenValues.get(baum)?.has('erfasst')).toBe(true);
  });

  it('leaves a visible type, its hidden stages and an active view alone', () => {
    const filter = createFilterController();
    filter.setValue(baum, 'erledigt', false, ['erfasst', 'erledigt']);
    filter.setActiveView({ kind: 'saved', key: 'x' });
    const ring = vi.fn();
    filter.subscribe(ring);
    afterCreate({ id, type: baum, filter, openFeature: vi.fn() });
    expect(ring).not.toHaveBeenCalled();
    expect(filter.state().hiddenValues.get(baum)?.has('erledigt')).toBe(true);
    expect(filter.activeView()).toEqual({ kind: 'saved', key: 'x' });
  });

  it('with an active view the detail still opens, and the view stays', () => {
    const filter = createFilterController();
    filter.setType(baum, false);
    filter.setActiveView({ kind: 'preset', key: 'p' });
    const openFeature = vi.fn();
    afterCreate({ id, type: baum, filter, openFeature });
    expect(openFeature).toHaveBeenCalledWith(id);
    expect(filter.activeView()).toEqual({ kind: 'preset', key: 'p' });
  });

  it('clears the pending parent link before the detail opens (v3 :2321)', () => {
    const order: string[] = [];
    afterCreate({
      id,
      type: baum,
      filter: createFilterController(),
      openFeature: () => order.push('open'),
      clearLink: () => order.push('clear'),
    });
    expect(order).toEqual(['clear', 'open']);
  });

  it('a type that is not known only opens the detail', () => {
    const openFeature = vi.fn();
    afterCreate({ id, type: undefined, filter: createFilterController(), openFeature });
    expect(openFeature).toHaveBeenCalledWith(id);
  });
});
