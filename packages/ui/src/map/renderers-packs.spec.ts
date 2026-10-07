// WP-650: the app hands the offline-pack protocol to the lazily loaded MapLibre renderer.
import { describe, expect, it, vi } from 'vitest';
import { testSource } from './test-helpers';
import type { PackRouting } from './maplibre/packs-types';

const seen = vi.hoisted(() => ({ options: undefined as unknown }));
vi.mock('./maplibre/renderer', () => ({
  createMaplibreRenderer: (options: unknown) => {
    seen.options = options;
    return { mount: () => ({ ready: Promise.resolve(), destroy: () => undefined }) };
  },
}));

const { createRendererMap, getRenderer } = await import('./renderers');

describe('createRendererMap with a pack protocol', () => {
  it('passes it to the MapLibre renderer on mount', async () => {
    const packProtocol = { name: 'ubtile' } as unknown as PackRouting;
    const handle = getRenderer(createRendererMap(new Map(), { packProtocol }), 'maplibre-2d').mount(
      {} as HTMLElement,
      {} as never,
      testSource([]),
    );
    await handle.ready;
    expect((seen.options as { packProtocol?: PackRouting }).packProtocol).toBe(packProtocol);
  });
});
