// WP-1065 (B-019): the family stack over the filter-visible set and the open count (v3 `computeFamilyStacks`).
import { describe, expect, it } from 'vitest';
import type { Edge, FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { createFamily } from '@ueberblick/ui';
import { createStacks, isOpen, type ProcessTypes } from './family-stack';

const id = (s: string): FeatureId => s as FeatureId;
const TYPES: ProcessTypes = { kontrolle: { process: { property: 'status', end: ['erledigt'] } } };
const TABLE = new Map([['kontrolle', [{ property: 'baum', parentType: 'baum' }]]]);

function world(kids: { id: string; status: string; at: string; lifecycle?: string }[]) {
  const states = new Map<string, FeatureState>([
    ['b1', { id: id('b1'), type: 'baum', properties: {}, lifecycle: 'active' } as unknown as FeatureState],
  ]);
  const edges: Edge[] = [];
  for (const k of kids) {
    states.set(k.id, {
      id: id(k.id),
      type: 'kontrolle',
      properties: { status: k.status },
      lifecycle: k.lifecycle ?? 'active',
      changedAt: k.at,
    } as unknown as FeatureState);
    edges.push({ from: id(k.id), relation: 'baum' as Key, to: id('b1'), derived: false });
  }
  const facts = {
    feature: (f: FeatureId) => states.get(f),
    edgesFrom: (f: FeatureId) => edges.filter((e) => e.from === f),
    edgesTo: (f: FeatureId) => edges.filter((e) => e.to === f),
  };
  const family = createFamily(TABLE, { ...facts, ownAnchor: () => [1, 2] });
  return (shown: (f: string) => boolean) =>
    createStacks({ types: TYPES, table: TABLE, facts, family, shown: (f) => shown(f) });
}

describe('family stack over the visible set', () => {
  const kids = [
    { id: 'k1', status: 'offen', at: '2026-01-01' },
    { id: 'k2', status: 'ueberfaellig', at: '2026-03-01' },
    { id: 'k3', status: 'erledigt', at: '2026-02-01' },
  ];
  it('parent visible: its children hide behind it', () => {
    const s = world(kids)(() => true);
    expect(['k1', 'k2', 'k3'].map((k) => s.hidden(id(k)))).toEqual([true, true, true]);
  });
  it('parent hidden, several children visible: the top one anchors, the rest hide', () => {
    const s = world(kids)((f) => f !== 'b1');
    expect(['k1', 'k2', 'k3'].map((k) => s.hidden(id(k)))).toEqual([true, false, true]);
    expect(s.headless(id('k2'))).toEqual([id('k3'), id('k1')]);
  });
  it('parent hidden, a lone child visible: an ordinary marker', () => {
    const s = world(kids)((f) => f === 'k1');
    expect(s.hidden(id('k1'))).toBe(false);
    expect(s.headless(id('k1'))).toEqual([]);
  });
  it('counts the open children: active and not at an end stage', () => {
    const s = world([...kids, { id: 'k4', status: 'offen', at: '2026-04-01', lifecycle: 'archiviert' }])(
      () => true,
    );
    expect(s.openCount(id('b1'))).toBe(2);
    expect(isOpen(TYPES, s.childrenOf(id('b1'))[2] as FeatureState)).toBe(false);
  });
  it('the badge counts only the open children that are shown', () => {
    const all = [...kids, { id: 'k4', status: 'offen', at: '2026-04-01' }];
    expect(world(all)(() => true).shownOpenCount(id('b1'))).toBe(3);
    expect(world(all)((f) => f !== 'k2').shownOpenCount(id('b1'))).toBe(2);
    expect(world(all)((f) => f === 'b1').shownOpenCount(id('b1'))).toBe(0);
  });
});
