// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { createToolHost, type MountPanelInput, type ToolTextSource } from '@ueberblick/ui';
import { describeToolContract, testMap, testPorts } from '@ueberblick/ui/tool-testing';
import { createSearchTool } from './search-tool';

const geo = createGeo();
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
const state = (n: number, properties: FeatureState['properties']): FeatureState => ({
  id: id(n),
  type: 'baum' as Key,
  properties,
  lifecycle: 'active',
  updatedSeq: n,
});
const FEATURES = [
  state(1, { nummer: 'Bäume 12', lage: { type: 'Point', coordinates: [9.1, 48.2] } }),
  state(2, { nummer: 'Baumhaus' }),
  state(3, { nummer: 'Eiche 7', lage: { type: 'Point', coordinates: [9.3, 48.4] } }),
];
const SOURCES: ToolTextSource[] = [{ type: 'baum' as Key, property: 'nummer' }];

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}

function setup(
  opts: { locale?: string; sources?: ToolTextSource[]; features?: FeatureState[]; throws?: boolean } = {},
) {
  const features = opts.features ?? FEATURES;
  const searchText = vi.fn<MountPanelInput['searchText']>((_s, q, limit) => {
    if (opts.throws) throw new Error('text_source_not_indexed');
    const f = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return features
      .filter((x) =>
        f(String(x.properties.nummer))
          .split(' ')
          .some((w) => w.startsWith(f(q.trim()))),
      )
      .slice(0, limit)
      .map((x) => x.id);
  });
  const centerOn = vi.fn();
  const openFeature = vi.fn<(i: FeatureId) => void>();
  const host = createToolHost({
    loaders: {
      search: async () =>
        createSearchTool({ geo, sources: opts.sources ?? SOURCES, primaryGeometry: () => 'lage' as Key }),
    },
    ports: testPorts(),
    ...(opts.locale ? { locale: opts.locale } : {}),
  });
  const root = document.createElement('div');
  document.body.append(root);
  const mounted = host.mountPanel(root, {
    point: 'tools-sheet',
    toolKey: 'search',
    startTask: vi.fn(),
    map: Object.assign(testMap(), { centerOn }),
    openFeature,
    searchText,
    feature: (i) => features.find((f) => f.id === i),
    typeLabel: (k) => (k === 'baum' ? 'Baum' : k),
  });
  const input = () => must(root.querySelector<HTMLInputElement>('input'));
  const type = (q: string) => {
    input().value = q;
    input().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const items = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.ub-search-item'));
  const status = () => must(root.querySelector('[role=status]')).textContent ?? '';
  return { root, mounted, type, input, items, status, searchText, centerOn, openFeature };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('search tool', () => {
  it('lists prefix matches, case and diacritic insensitive, from the store port with the configured sources', async () => {
    const t = setup();
    await t.mounted;
    t.type('BAUME');
    expect(t.items().map((b) => b.textContent)).toEqual(['Bäume 12Baum']);
    t.type('baum');
    expect(t.items()).toHaveLength(2);
    expect(t.searchText).toHaveBeenLastCalledWith(SOURCES, 'baum', 21);
    expect(t.status()).toContain('2 result');
  });

  it('the second line is the type label from the context, and the button is named "<text>, <type label>"', async () => {
    const t = setup();
    await t.mounted;
    t.type('eiche');
    const b = must(t.items()[0]);
    expect(must(b.querySelector('.ub-search-item-type')).textContent).toBe('Baum');
    expect(b.getAttribute('aria-label')).toBe('Eiche 7, Baum');
  });

  it('one tap on a result centres the map and opens the feature sheet', async () => {
    const t = setup();
    await t.mounted;
    t.type('eiche');
    must(t.items()[0]).click();
    expect(t.centerOn).toHaveBeenCalledWith([9.3, 48.4]);
    expect(t.openFeature).toHaveBeenCalledWith(id(3));
  });

  it('a feature without a position still opens, and says so', async () => {
    const t = setup();
    await t.mounted;
    t.type('baumh');
    must(t.items()[0]).click();
    expect(t.centerOn).not.toHaveBeenCalled();
    expect(t.openFeature).toHaveBeenCalledWith(id(2));
    expect(t.status()).toContain('no position');
  });

  it('Enter opens the first result; arrows move through the list; Escape clears', async () => {
    const t = setup();
    await t.mounted;
    t.type('baum');
    t.input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(t.items()[0]);
    t.items()[0]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(t.input());
    t.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(t.openFeature).toHaveBeenCalledWith(id(1));
    t.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(t.input().value).toBe('');
    expect(t.items()).toHaveLength(0);
  });

  it('says so with no hits, with no configured sources, and when the index is not ready', async () => {
    const a = setup();
    await a.mounted;
    a.type('zzz');
    expect(a.status()).toContain('No results for "zzz"');
    document.body.innerHTML = '';
    const b = setup({ sources: [] });
    await b.mounted;
    expect(b.status()).toContain('No search fields');
    b.type('x');
    expect(b.searchText).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    const c = setup({ throws: true });
    await c.mounted;
    c.type('x');
    expect(c.status()).toContain('not ready');
  });

  it('caps the list and tells the user to narrow down', async () => {
    const many = Array.from({ length: 30 }, (_, i) => state(50 + i, { nummer: `Baum ${i}` }));
    const t = setup({ features: many });
    await t.mounted;
    t.type('baum');
    expect(t.items()).toHaveLength(20);
    expect(t.status()).toContain('first 20');
  });

  it('speaks German', async () => {
    const t = setup({ locale: 'de' });
    await t.mounted;
    t.type('zzz');
    expect(t.status()).toContain('Keine Treffer');
    expect(t.root.textContent).toContain('Suche');
  });

  it('has no accessibility violations', async () => {
    const t = setup();
    await t.mounted;
    t.type('baum');
    const res = await axe.run(t.root, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});

describeToolContract({
  name: 'search',
  tool: () => createSearchTool({ geo, sources: SOURCES, primaryGeometry: () => 'lage' as Key }),
  drive: async (root) => {
    const input = must(root.querySelector<HTMLInputElement>('input'));
    input.value = 'baum';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },
});
