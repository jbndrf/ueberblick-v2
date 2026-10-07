// @vitest-environment jsdom
// WP-643: closing the feature slot slides the shell out before the slot unmounts (v3 keeps the shell mounted and flips
// `isOpen`); a task with a form opens it in the same shell family and the feature sheet comes back when it closes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { goldenConfig } from '@ueberblick/core/testing';
import '@ueberblick/ui/testing';
import axe from 'axe-core';

afterEach(() => (cleanup(), document.body.removeAttribute('style'))); // a closed menu may leave its modal layer
beforeEach(() => {
  window.innerWidth = 480;
});

import type { FeatureState } from '@ueberblick/core/model';
import { area, config, setup, tree } from './FeatureSlot.testing';

const featureShell = () => screen.getByTestId('feature-sheet');

describe('feature slot', () => {
  it('closing slides the shell out first; the slot unmounts when the slide is over', async () => {
    const { onclose } = setup();
    await screen.findByRole('heading', { level: 3 });
    await waitFor(() => expect(featureShell().dataset['open']).toBe('true'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schließen' }));
    expect(featureShell().dataset['open']).toBe('false');
    expect(featureShell()).toBeTruthy(); // still mounted: the slide-out is visible
    expect(onclose).not.toHaveBeenCalled();
    await waitFor(() => expect(onclose).toHaveBeenCalledTimes(1), { timeout: 1500 });
  });

  it.each([390, 1280])(
    'a task with a form replaces the feature body in the same shell, one shell only (%i px)',
    async (width) => {
      window.innerWidth = width;
      setup();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Befund ergänzen/ }));
      await screen.findByLabelText(/Befund/);
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(screen.queryByTestId('form-shell')).toBeNull();
      await waitFor(() => expect(featureShell().dataset['open']).toBe('true'));
      expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Baum');
      expect(screen.queryByRole('button', { name: /Befund ergänzen/ })).toBeNull(); // the action row is gone
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      // back to the feature body, as v3, with no second shell involved
      expect(await screen.findByRole('button', { name: /Befund ergänzen/ })).toBeTruthy();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    },
  );

  it('the open feature sheet does not lock the rest of the shell (v3: bar, header and map keep taking taps)', async () => {
    setup();
    await screen.findByRole('dialog');
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  it.each([390, 1280])(
    'the bottom bar hides while a location step is edited and comes back after (v3 isEditingLocation) (%i px)',
    async (width) => {
      window.innerWidth = width;
      const { setPlacing } = setup();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
      // no question on the tap: a task with several steps asks at Absenden (WP-730, B-023)
      expect(screen.queryByRole('button', { name: 'Fortfahren' })).toBeNull();
      await user.click(await screen.findByRole('button', { name: 'Weiter' }));
      await waitFor(() => expect(setPlacing).toHaveBeenLastCalledWith(true));
      await user.click(await screen.findByTestId('placement-confirm'));
      await waitFor(() => expect(setPlacing).toHaveBeenLastCalledWith(false));
    },
  );
  it('"Im Chat erwähnen" in the header menu seeds this feature and asks for the chat, when the person has it (v3 +page.svelte:2254-2258)', async () => {
    const { chat, onclose } = setup(config, { chatOn: true });
    await screen.findByRole('heading', { level: 3 });
    const more = screen.getByRole('button', { name: 'Weitere Aktionen' });
    more.focus();
    await userEvent.keyboard('{Enter}');
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    await userEvent
      .setup()
      .click(items.find((i) => /Im Chat erwähnen/.test(i.textContent ?? '')) as HTMLElement);
    expect(chat.seed.take()).toBe('#t1 ');
    expect(chat.takeOpenRequest()).toBe(true);
    expect(onclose).not.toHaveBeenCalled(); // the feature stays open beside the chat
  });

  it('has no header menu when the person has no chat', async () => {
    setup(config);
    await screen.findByRole('heading', { level: 3 });
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
  });
});

// WP-687 (owner bug): a task that edits the location goes straight onto the map, as v3 (`handleTaskInvoke` :583-606).
const config2 = goldenConfig('templates/baumkataster/2.0.0.yaml');
// page-level rules (contrast needs real layout, region needs the page's landmarks) are not the component's
const noContrast = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };

describe('a task that edits the location', () => {
  it.each([390, 1280])(
    'a point: the pin starts at the stored position, the bar hides, no empty note (%i px)',
    async (width) => {
      window.innerWidth = width;
      const { setPlacing, map, submit } = setup();
      await userEvent.setup().click(await screen.findByRole('button', { name: /Baum verschieben/ }));
      await waitFor(() => expect(setPlacing).toHaveBeenLastCalledWith(true));
      expect(map.markerPosition('placement-pin')).toEqual([7.05, 50.05]);
      expect(screen.queryByText(/Noch keine Form|No shape yet/)).toBeNull();
      expect(screen.queryByTestId('draw-summary')).toBeNull();
      expect((await axe.run(document.body, noContrast)).violations.map((v) => v.id)).toEqual([]);
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it('a map tap moves the pin and closes nothing; the confirm submits one run with the new point', async () => {
    const { setPlacing, map, submit } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Baum verschieben/ }));
    await screen.findByTestId('placement-confirm');
    map.taps.forEach((f) => f([7.2, 50.3]));
    await user.click(screen.getByTestId('placement-confirm'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'verschieben',
        featureId: 't1',
        input: { geometrie: { type: 'Point', coordinates: [7.2, 50.3] } },
      }),
    );
    await waitFor(() => expect(setPlacing).toHaveBeenLastCalledWith(false));
    expect(await screen.findByRole('button', { name: /Baum verschieben/ })).toBeTruthy(); // the sheet is back
  });

  it('cancel brings the sheet back and writes nothing', async () => {
    const { setPlacing, submit } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Baum verschieben/ }));
    await user.click(await screen.findByTestId('placement-cancel'));
    await waitFor(() => expect(setPlacing).toHaveBeenLastCalledWith(false));
    expect(await screen.findByRole('button', { name: /Baum verschieben/ })).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('a refusal shows its reason', async () => {
    setup(config, { refuse: 'zu nah am Rand' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Baum verschieben/ }));
    await user.click(await screen.findByTestId('placement-confirm'));
    // v3 shows the rejection sentence alone (`+page.svelte:2366`, `alert(taskRunRejectionText(...))`), with no prefix.
    expect((await screen.findByRole('alert')).textContent?.trim()).toBe('zu nah am Rand');
  });

  it.each([390, 1280])(
    'an area: the draw tool opens with the stored shape and confirms one run (%i px)',
    async (width) => {
      window.innerWidth = width;
      const { setPlacing, map, submit } = setup(config2, { feature: area, roles: ['verwaltung'] });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Fläche bearbeiten/ }));
      await screen.findByTestId('draw-toolbar');
      await waitFor(() => expect(setPlacing).toHaveBeenLastCalledWith(true));
      expect([...map.markers.keys()].filter((k) => k.startsWith('draw-')).length).toBe(3); // the loaded vertices
      expect(screen.queryByText(/Noch keine Form|No shape yet/)).toBeNull();
      expect((await axe.run(document.body, noContrast)).violations.map((v) => v.id)).toEqual([]);
      await user.click(screen.getByTestId('draw-finish'));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submit.mock.calls[0]?.[0]).toMatchObject({ task: 'flaeche_bearbeiten', featureId: 'a1' });
    },
  );

  it('a geometry field among other fields places first, then the form opens with the new position', async () => {
    const mixed = {
      ...config,
      file: {
        ...config.file,
        tasks: {
          ...config.file.tasks,
          verschieben: {
            ...config.file.tasks?.['verschieben'],
            form: { geometrie: { tool: 'draw' }, beschreibung: {} },
          },
        },
      },
    } as typeof config;
    const { map, submit } = setup(mixed);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Baum verschieben/ }));
    map.taps.forEach((f) => f([7.2, 50.3]));
    await user.click(await screen.findByTestId('placement-confirm'));
    // the form opens, and the new position is no row of it: the map set it (v3; WP-697)
    await user.type(await screen.findByRole('textbox'), 'neuer Platz');
    expect(screen.queryByTestId('draw-summary')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Submit|Senden|Absenden|Speichern/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'verschieben',
        input: expect.objectContaining({
          beschreibung: { de: 'neuer Platz' },
          geometrie: { type: 'Point', coordinates: [7.2, 50.3] },
        }),
      }),
    );
  });
});
// WP-742: a task that creates a child ends on it (v3 `+page.svelte:2345-2375`, the new object is selected).
describe('a task that creates a child of the open feature', () => {
  it('opens the new child when the run is stored', async () => {
    const event = { ...tree, id: 'v1', type: 'veranstaltung', properties: { status: 'in_pruefung' } };
    const { openFeature, submit } = setup(goldenConfig('templates/veranstaltung/1.0.0.yaml'), {
      feature: event as unknown as FeatureState,
      roles: ['sachbearbeiter'],
      createdBy: ['auflage-1'],
      accept: true,
    });
    const user = userEvent.setup();
    // "Auflage erteilen" is no action-row button: the relation menu offers it as "Auflage anlegen" (v3 has no such button)
    (await screen.findByRole('button', { name: 'Verknüpfte Objekte' })).focus();
    await userEvent.keyboard('{Enter}');
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    await user.click(items.find((i) => /Auflage anlegen/.test(i.textContent ?? '')) as HTMLElement);
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
    await user.type(await screen.findByRole('textbox'), 'Brandwache');
    await user.click(screen.getByRole('button', { name: /Submit|Senden|Absenden|Speichern/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(openFeature).toHaveBeenCalledWith('auflage-1'));
  });
});
