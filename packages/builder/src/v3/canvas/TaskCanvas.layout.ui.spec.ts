// @vitest-environment jsdom
// The drag itself needs a real browser (jsdom has no pointer layout; d3-drag needs the window of its realm): the e2e
// `builder-canvas-layout.spec.ts` drags and reloads. The debounce and the pruning are in `layout-api.spec.ts`.
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import DummyInspector from '../shell/DummyInspector.testing.svelte';
import { createBuilderRegistry } from '../shell/registry';
import './jsdom.testing';
import { registerCanvas } from './index';
import { CANVAS_LAYOUT_API_CONTEXT, type CanvasLayoutApi, type PlacedNode } from './layout-api';

function mount(api?: CanvasLayoutApi) {
  const registry = createBuilderRegistry();
  registerCanvas(registry);
  for (const kind of ['stage', 'task', 'rule', 'none'] as const)
    registry.registerInspector(kind, DummyInspector);
  const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
  const context = new Map<symbol, unknown>(api ? [[CANVAS_LAYOUT_API_CONTEXT, api]] : []);
  return render(BuilderShell, { props: { doc, type: 'baum', locale: 'de', registry }, context });
}
/** Where xyflow put a node: its `transform: translate(Xpx, Ypx)`. */
const at = (id: string): string | undefined =>
  (document.querySelector(`.svelte-flow__node[data-id="${id}"]`) as HTMLElement | null)?.style.transform
    .replace(/\s+/g, '')
    .match(/translate\((.*?)\)/)?.[1];
const fakeApi = (stored: readonly PlacedNode[]) => {
  const save = vi.fn(async () => undefined);
  return { api: { load: async () => stored, save } satisfies CanvasLayoutApi, save };
};

describe('canvas with stored positions (WP-366)', () => {
  it('shows a stored node where it was left, and the others where the arrangement puts them', async () => {
    mount(
      fakeApi([
        { id: 'stage:kontrolliert', x: 1234, y: 567 },
        { id: 'global', x: -999, y: 321 },
      ]).api,
    );
    await waitFor(() => expect(at('stage:kontrolliert')).toBe('1234px,567px'));
    expect(at('global')).toBe('-999px,321px');
    // an unstored node keeps the automatic arrangement (arrange.ts: x is a column, y starts at 0)
    expect(at('stage:erfasst')).toMatch(/^-?\d+(\.\d+)?px,-?\d+(\.\d+)?px$/);
    expect(at('stage:erfasst')).not.toBe('1234px,567px');
  });

  it('ignores the stored position of a node that no longer exists', async () => {
    mount(fakeApi([{ id: 'stage:entfernt', x: 5, y: 5 }]).api);
    await waitFor(() => expect(at('stage:erfasst')).toBeDefined());
    expect(document.querySelector('.svelte-flow__node[data-id="stage:entfernt"]')).toBeNull();
  });

  it('falls back to the arrangement when the positions cannot be loaded', async () => {
    mount({ load: async () => Promise.reject(new Error('offline')), save: async () => undefined });
    await waitFor(() => expect(at('stage:erfasst')).toBeDefined());
  });

  it('makes every node kind draggable: stage, Global container, entry marker, rule', async () => {
    mount(fakeApi([]).api);
    await waitFor(() => expect(at('stage:erfasst')).toBeDefined());
    const nodes = [...document.querySelectorAll<HTMLElement>('.svelte-flow__node')];
    expect(nodes.length).toBeGreaterThan(6);
    for (const n of nodes) expect(n.classList.contains('draggable')).toBe(true);
    expect(nodes.some((n) => n.dataset['id'] === 'global')).toBe(true);
    expect(nodes.some((n) => n.dataset['id']?.startsWith('entry:'))).toBe(true);
  });

  it('without a host api the canvas still shows at once', () => {
    mount();
    expect(at('stage:erfasst')).toBeDefined();
  });
});
