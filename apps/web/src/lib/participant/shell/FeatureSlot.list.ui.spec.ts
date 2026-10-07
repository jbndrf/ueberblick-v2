// @vitest-environment jsdom
// WP-783: a map task started from a Liste row closes the Liste and places on the map.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { goldenConfig } from '@ueberblick/core/testing';
import { area, config, setup } from './FeatureSlot.testing';

afterEach(() => (cleanup(), document.body.removeAttribute('style')));
beforeEach(() => {
  window.innerWidth = 480;
});

describe('a map task started while the Liste is shown (WP-783)', () => {
  it.each([390, 1280])(
    'the Liste closes, the map flies to the feature and the pin is placed, not the empty form (%i px)',
    async (width) => {
      window.innerWidth = width;
      const { map, centerOn, submit } = setup(config, { listShown: true });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Baum verschieben/ }));
      await screen.findByTestId('placement-confirm');
      expect(screen.queryByText(/Noch keine Form|No shape yet/)).toBeNull();
      expect(centerOn).toHaveBeenCalledWith([7.05, 50.05], expect.anything());
      map.taps.forEach((f) => f([7.2, 50.3]));
      await user.click(screen.getByTestId('placement-confirm'));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          task: 'verschieben',
          input: { geometrie: { type: 'Point', coordinates: [7.2, 50.3] } },
        }),
      );
    },
  );

  it('Fläche bearbeiten: the Liste closes and the draw tool opens with the stored shape, not the empty form', async () => {
    const config2 = goldenConfig('templates/baumkataster/2.0.0.yaml');
    const { map, submit } = setup(config2, { feature: area, roles: ['verwaltung'], listShown: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Fläche bearbeiten/ }));
    await screen.findByTestId('draw-toolbar');
    expect(screen.queryByText(/Noch keine Form|No shape yet/)).toBeNull();
    expect([...map.markers.keys()].filter((k) => k.startsWith('draw-')).length).toBe(3);
    await user.click(screen.getByTestId('draw-finish'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ task: 'flaeche_bearbeiten', featureId: 'a1' });
  });
});
