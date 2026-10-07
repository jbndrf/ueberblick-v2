// @vitest-environment jsdom
// WP-679: the Vorschau banner sits above the header on a preview login and is absent in a real project.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@ueberblick/ui';
import { cleanup, render, screen } from '@testing-library/svelte';
import axe from 'axe-core';
import { deviceOf, props } from './map-screen.testing';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: () => undefined }));
vi.mock('@ueberblick/ui', async (importOriginal) => {
  const real = await importOriginal<typeof Ui>();
  const handle = {
    ready: Promise.resolve(),
    onFeatureTap: () => () => undefined,
    onClusterTap: () => () => undefined,
    onMapTap: () => () => undefined,
    onExtentChange: () => () => undefined,
    extent: () => [7, 50, 8, 51],
    centerOn: () => undefined,
    showOverlay: () => undefined,
    destroy: () => undefined,
  };
  return { ...real, createRendererMap: () => new Map([['maplibre-2d', { mount: () => handle }]]) };
});
const { default: MapScreen } = await import('./MapScreen.svelte');

afterEach(cleanup);

describe('the map screen: Vorschau banner', () => {
  it.each([390, 1280])(
    'shows the Vorschau banner above the header on a preview login, and none in a real project (%i px, WP-679)',
    async (width) => {
      window.innerWidth = width;
      render(MapScreen, props());
      await screen.findByRole('region', { name: 'Karte' });
      expect(screen.queryByTestId('preview-banner')).toBeNull();
      cleanup();
      const device = deviceOf();
      (device.identity.project as { preview: boolean }).preview = true;
      const { container } = render(MapScreen, props({ device }));
      await screen.findByRole('region', { name: 'Karte' });
      const banner = screen.getByTestId('preview-banner');
      expect(banner.textContent).toContain('Vorschau – Testdaten, nicht die echten Daten');
      expect(banner.compareDocumentPosition(screen.getByRole('banner'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
  );
});
