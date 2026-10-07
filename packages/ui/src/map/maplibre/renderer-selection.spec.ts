import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { LAYERS } from './layers';
import { SELECT_IDS, selectionFilters } from './selection';
import { mount, tick } from './renderer-fixture';

const id = (s: string): FeatureId => s as FeatureId;
const filterOf = (calls: { filters: { layer: string; filter: unknown }[] }, layer: string) =>
  calls.filters.filter((f) => f.layer === layer).at(-1)?.filter;

async function opened() {
  const m = mount();
  await m.handle.ready;
  await tick();
  return m;
}

describe('maplibre-2d renderer: selected-feature highlight (WP-733)', () => {
  it('marks the open feature and only it: every highlight layer filters on that id', async () => {
    const { handle, calls } = await opened();
    handle.setSelected?.({ id: id('p1'), color: '#123456' });
    expect(filterOf(calls, SELECT_IDS.ring)).toEqual([
      'all',
      ['!', ['has', 'clusterId']],
      ['==', ['get', 'featureId'], 'p1'],
    ]);
    expect(filterOf(calls, SELECT_IDS.halo)).toEqual(filterOf(calls, SELECT_IDS.ring));
    expect(filterOf(calls, SELECT_IDS.line)).toEqual(['==', ['get', 'id'], 'p1']);
    expect(filterOf(calls, SELECT_IDS.fill)).toEqual([
      'all',
      ['==', ['geometry-type'], 'Polygon'],
      ['==', ['get', 'id'], 'p1'],
    ]);
    expect(
      calls.paints
        .filter((p) => p.value === '#123456')
        .map((p) => p.layer)
        .sort(),
    ).toEqual([SELECT_IDS.fill, SELECT_IDS.halo, SELECT_IDS.line, SELECT_IDS.ring].sort());
  });

  it('closing the sheet removes it: the filters match nothing', async () => {
    const { handle, calls } = await opened();
    handle.setSelected?.({ id: id('p1'), color: '#123456' });
    handle.setSelected?.(null);
    expect(filterOf(calls, SELECT_IDS.ring)).toEqual(selectionFilters(null)[SELECT_IDS.ring]);
    expect(JSON.stringify(filterOf(calls, SELECT_IDS.line))).not.toContain('p1');
  });

  it('navigating to another feature moves it', async () => {
    const { handle, calls } = await opened();
    handle.setSelected?.({ id: id('p1'), color: '#123456' });
    handle.setSelected?.({ id: id('poly1'), color: '#123456' });
    expect(JSON.stringify(filterOf(calls, SELECT_IDS.line))).toContain('poly1');
    expect(JSON.stringify(filterOf(calls, SELECT_IDS.ring))).toContain('poly1');
  });

  it('the same selection again touches nothing, and a selection costs four filters, never a data write', async () => {
    const { handle, calls } = await opened();
    const data = calls.setData.length;
    const diffs = calls.updateData.length;
    const before = calls.filters.length;
    handle.setSelected?.({ id: id('p1'), color: '#123456' });
    handle.setSelected?.({ id: id('p1'), color: '#123456' });
    expect(calls.filters.length - before).toBe(4);
    expect(calls.setData.length).toBe(data);
    expect(calls.updateData.length).toBe(diffs);
  });

  it('a selection made before the map loads is on the layers once they are drawn', async () => {
    const m = mount();
    m.handle.setSelected?.({ id: id('p2'), color: '#abcdef' });
    await m.handle.ready;
    expect(JSON.stringify(filterOf(m.calls, SELECT_IDS.ring))).toContain('p2');
  });

  it('a redraw of the layers (a new style) keeps the selection', async () => {
    const m = await opened();
    m.handle.setSelected?.({ id: id('p1'), color: '#123456' });
    m.calls.filters.length = 0;
    m.handle.setView({ ...({} as object) } as never);
    expect(JSON.stringify(filterOf(m.calls, SELECT_IDS.ring))).toContain('p1');
  });

  it('the highlight layers are not tappable', async () => {
    const m = await opened();
    m.calls.rendered.push({ layer: { id: SELECT_IDS.ring }, properties: { featureId: 'p1' } });
    const taps: string[] = [];
    m.handle.onFeatureTap((f) => taps.push(f));
    m.calls.mapClick?.({ lngLat: { lng: 8, lat: 50 }, point: { x: 1, y: 1 } });
    expect(taps).toEqual([]);
  });

  it('layer order: shape highlight above the shapes, ring behind the marker, counts on top', async () => {
    const { calls } = await opened();
    const at = (s: string): number => calls.layers.indexOf(s);
    expect(at('ub-shape-line')).toBeLessThan(at(SELECT_IDS.fill));
    expect(at(SELECT_IDS.fill)).toBeLessThan(at(SELECT_IDS.line));
    expect(at(SELECT_IDS.halo)).toBeLessThan(at(SELECT_IDS.ring));
    expect(at(SELECT_IDS.ring)).toBeLessThan(at('ub-single'));
    expect(at(SELECT_IDS.ring)).toBeLessThan(at('ub-cluster'));
    expect(at('ub-cluster')).toBeLessThan(at('ub-cluster-count'));
    expect(LAYERS.length).toBe(11);
  });
});

describe('maplibre-2d renderer: pointer cursor (WP-733)', () => {
  it('is a pointer over a tappable feature and the default again on leaving', async () => {
    const { calls } = await opened();
    calls.hovers.get('mouseenter:ub-single')?.();
    expect(calls.cursor.cursor).toBe('pointer');
    calls.hovers.get('mouseleave:ub-single')?.();
    expect(calls.cursor.cursor).toBe('');
  });

  it('stays a pointer while another layer is still under the mouse', async () => {
    const { calls } = await opened();
    calls.hovers.get('mouseenter:ub-single')?.();
    calls.hovers.get('mouseenter:ub-shape-fill')?.();
    calls.hovers.get('mouseleave:ub-single')?.();
    expect(calls.cursor.cursor).toBe('pointer');
    calls.hovers.get('mouseleave:ub-shape-fill')?.();
    expect(calls.cursor.cursor).toBe('');
  });

  it('listens on tappable layers only, not on the highlight', async () => {
    const { calls } = await opened();
    expect(calls.hovers.has(`mouseenter:${SELECT_IDS.ring}`)).toBe(false);
    expect(calls.hovers.has('mouseenter:ub-cluster')).toBe(true);
  });
});
