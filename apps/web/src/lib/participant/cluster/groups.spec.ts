// v3's `buildClusterGroups` (`+page.svelte:1808-1869`) on the device's features: one group per Objektart (v3: workflow),
// one row per stage (v3 filter mode "stage"), rows by count descending, groups by count descending, rounded percent.
import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { buildClusterGroups, rowIds } from './groups';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const states = new Map<string, FeatureState>();
const add = (id: string, type: string, props: Record<string, unknown>): FeatureId => {
  states.set(id, {
    id,
    type: type as Key,
    properties: props,
    lifecycle: 'active',
  } as unknown as FeatureState);
  return id as FeatureId;
};
const members = (...ids: FeatureId[]) => ids.map((id) => ({ id, at: [8, 50] as [number, number] }));
const feature = (id: FeatureId) => states.get(id);

describe('buildClusterGroups', () => {
  const e1 = add('e1', 'baum', { stage: 'erfasst' });
  const e2 = add('e2', 'baum', { stage: 'erfasst' });
  const e3 = add('e3', 'baum', { stage: 'erfasst' });
  const d1 = add('d1', 'baum', { stage: 'erledigt' });
  const f1 = add('f1', 'flaeche', {});
  const f2 = add('f2', 'flaeche', {});

  it('groups by Objektart, biggest first, with the label in the locale and the count', () => {
    const groups = buildClusterGroups(config, 'de', members(e1, d1, f1, f2, e2, e3), feature);
    expect(groups.map((g) => [g.type, g.totalCount])).toEqual([
      ['baum', 4],
      ['flaeche', 2],
    ]);
    expect(groups[0]?.label).toBe((config.file.types?.baum?.label as Record<string, string>).de);
  });

  it('rows are the stages that occur, biggest first, with label, rounded percent and the member ids', () => {
    const baum = buildClusterGroups(config, 'de', members(e1, d1, e2, e3), feature)[0];
    expect(baum?.rows.map((r) => [r.key, r.count, r.percentage])).toEqual([
      ['erfasst', 3, 75],
      ['erledigt', 1, 25],
    ]);
    expect(baum?.rows[0]?.label).toBe('Erfasst');
    expect(rowIds(baum?.rows[0])).toEqual(['e1', 'e2', 'e3']);
  });

  it('a type without a process has one row, named for the Objektart', () => {
    const flaeche = buildClusterGroups(config, 'de', members(f1, f2), feature)[0];
    expect(flaeche?.rows).toHaveLength(1);
    expect(flaeche?.rows[0]).toMatchObject({ count: 2, percentage: 100, label: flaeche?.label });
  });

  it('every row has a colour; a member that is no longer on the device is left out', () => {
    const groups = buildClusterGroups(config, 'de', members(e1, 'gone' as FeatureId), feature);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.totalCount).toBe(1);
    expect(groups.flatMap((g) => g.rows).every((r) => r.color !== '')).toBe(true);
  });

  it('is empty for no members', () => {
    expect(buildClusterGroups(config, 'de', [], feature)).toEqual([]);
  });
});
