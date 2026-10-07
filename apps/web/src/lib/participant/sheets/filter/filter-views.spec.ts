/** WP-808 (Q20): the role's presets are offered with the Ansichten tool off; own views need the tool. */
import { describe, expect, it } from 'vitest';
import { viewsOffered, type FilterViews } from './filter-views';

const presets = [{ key: 'p', label: 'P' }];
const own: FilterViews = { presets, saved: [], save: () => undefined };

describe('viewsOffered', () => {
  it('tool off: presets only, no own views', () => {
    const v = viewsOffered(presets, undefined);
    expect(v?.presets).toEqual(presets);
    expect(v?.save).toBeUndefined();
    expect(v?.saved).toBeUndefined();
  });
  it('tool on: the own views too', () => {
    expect(viewsOffered(presets, own)?.save).toBeDefined();
  });
  it('no presets and no tool: no tab', () => {
    expect(viewsOffered([], undefined)).toBeUndefined();
  });
});
