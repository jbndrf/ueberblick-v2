import { describe, expect, it } from 'vitest';
import { lineText } from './entry-text';
import { DIFF_CHANGES } from '@ueberblick/core/registry/compile';
import type { PlanEntry } from './types';

describe('lineText', () => {
  it('has a line for every diff kind, including order_changed', () => {
    for (const key of DIFF_CHANGES.keys) {
      const e: PlanEntry = { path: 'types.tree.properties', change: key, breaking: false, name: 'Baum' };
      expect(lineText('de', e)).not.toBe('');
    }
  });

  it('names the owner and what was reordered for an order-only change', () => {
    const e: PlanEntry = {
      path: 'types.tree.properties',
      change: 'order_changed',
      breaking: false,
      name: 'Baum',
      order: { map: 'types.*.properties', owner: 'types.tree' },
    };
    expect(lineText('de', e)).toContain('Reihenfolge der Eigenschaften geändert');
    expect(lineText('en', e)).toContain('order of properties changed');
  });
});
