// @vitest-environment jsdom
// WP-652: the `create` slot: + opens the picker (v3 WorkflowSelector), a point type goes through the pin, and Bestätigen
// opens the create form in the shared shell with the pin as the initial geometry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, Instant, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { goldenConfig } from '@ueberblick/core/testing';
import '@ueberblick/ui/testing';
import { createDeviceIds } from '../ids';
import { createReader } from '../reader';
import axe from 'axe-core';
import { createFilterController } from '../sheets/filter/filter-controller';
import CreateSlot from './CreateSlot.svelte';
import { PARENT, noActivity, fakeMap, removeFakeMarkers, withParentRelation } from './fake-map.testing';

afterEach(() => {
  cleanup();
  removeFakeMarkers();
});
beforeEach(() => {
  window.innerWidth = 390;
});

const golden = goldenConfig('templates/baumkataster/1.0.0.yaml');
const at = () => '2026-10-01T12:00:00Z' as Instant;
function setup(
  over: {
    quota?: number;
    created?: number;
    recentOpen?: boolean;
    map?: boolean;
    pickerShown?: boolean;
    /** What the run queue answers to a submitted run (default: the run is accepted). */
    result?: 'accepted' | 'refused';
    online?: boolean;
    hiddenType?: boolean;
    /** A Fläche in view that Baum may be linked to (adds an optional parent relation to the golden config). */
    parent?: boolean;
    /** The type `hiddenType` switches off (default baum). */
    hiddenOf?: string;
    /** The run queue's plan of a `$none` create made no feature. */
    createsNothing?: boolean;
  } = {},
) {
  const base = over.parent === true ? withParentRelation(golden) : golden;
  const config =
    over.quota === undefined
      ? base
      : {
          ...base,
          file: {
            ...base.file,
            roles: {
              ...base.file.roles,
              verwaltung: { ...golden.file.roles?.['verwaltung'], quota: over.quota },
            },
          },
        };
  const actor: Actor = { id: 'anna', kind: 'participant', roles: ['verwaltung' as Key] };
  const facts: Facts = {
    feature: (id) => (over.parent === true && id === PARENT.id ? PARENT : undefined),
    near: (type) => (over.parent === true && type === 'flaeche' ? [PARENT] : []),
    ofType: () => [],
    edgesFrom: () => [],
    edgesTo: () => [],
    history: () => [],
    observationsByActor: () => [],
    featuresWith: () => [],
    createdBy: () => over.created ?? 0,
  };
  const ids = createDeviceIds({ now: at }, (n) => new Uint8Array(n));
  const geo = createGeo();
  const reader = createReader({
    facts,
    versions: { deployed: 1, get: () => config as never },
    bootstrapVersion: 1,
    actor,
    geo,
    clock: { now: at },
    ids,
    locale: 'de',
    activity: noActivity,
    actorName: 'Anna',
  });
  // what the run queue's plan created per run: a `$none` create gets one id, as the queue's seeded ids give it
  const planned = new Map<string, FeatureId[]>();
  const NEW_SPECIES = '30000000-0000-7000-8000-000000000001' as FeatureId;
  const submit = vi.fn<(run: unknown) => Promise<'queued'>>(async (run) => {
    const r = run as { id: string; task: string; featureId?: string };
    if (r.task === 'baumart_anlegen' && over.createsNothing !== true) planned.set(r.id, [NEW_SPECIES]);
    return 'queued';
  });
  const device = {
    reader,
    config,
    actor,
    roleKey: 'verwaltung',
    geo,
    blobs: {},
    ids,
    clock: { now: at },
    store: { featureIdsOfType: () => [], facts },
    feature: (id: FeatureId) => facts.feature(id),
    queue: { createdBy: (id: string) => planned.get(id) ?? [] },
    submitter: {
      submit,
      outcome: (_id: string, listener: (p: unknown) => void) => {
        listener(
          over.result === 'refused' ? { state: 'refused', reason: 'Nicht erlaubt' } : { state: 'accepted' },
        );
        return () => undefined;
      },
    },
    drafts: { get: async () => undefined, put: async () => undefined, drop: async () => undefined },
    changed: { subscribe: () => () => undefined, stop: () => undefined },
  };
  const onclose = vi.fn();
  const closeSlot = vi.fn();
  const setPlacing = vi.fn();
  const setForm = vi.fn();
  const filter = createFilterController();
  if (over.hiddenType === true) filter.setType((over.hiddenOf ?? 'baum') as Key, false, ['erfasst']);
  const ctx = {
    device,
    filter,
    locale: 'de',
    online: over.online ?? true,
    map: over.map === false ? undefined : fakeMap(),
    center: () => [7.1, 50.1] as const,
    openFeature: vi.fn(),
    recentOpen: over.recentOpen ?? false,
    closeSlot,
    setPlacing,
    pickerShown: over.pickerShown ?? false,
    setForm,
  };
  const view = render(CreateSlot, { ctx: ctx as never, onclose });
  return { onclose, closeSlot, setPlacing, setForm, view, ctx, submit, filter, NEW_SPECIES };
}

describe('create slot', () => {
  it('lists what the role may create, in a picker above the + (centre)', async () => {
    setup();
    expect((await screen.findAllByTestId('create-pill')).map((p) => p.textContent?.trim())).toContain(
      'Baum erfassen',
    );
    expect(screen.getByTestId('create-picker').className).toContain('left-1/2');
  });

  it('beside Zuletzt the picker moves to the left; the backdrop closes the slot and Zuletzt', async () => {
    const { onclose, closeSlot } = setup({ recentOpen: true });
    await screen.findAllByTestId('create-pill');
    expect(screen.getByTestId('create-picker').className).toContain('md:left-16');
    await userEvent.setup().click(screen.getByLabelText('Menü schließen'));
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(closeSlot).toHaveBeenCalledWith('recent');
  });

  it('a role at its quota gets the hint and disabled pills', async () => {
    setup({ quota: 2, created: 2 });
    expect((await screen.findByRole('status')).textContent).toContain('Limit erstellter Einträge');
    expect(screen.getAllByTestId<HTMLButtonElement>('create-pill').every((b) => b.disabled)).toBe(true);
  });

  it('below its quota the pills are enabled', async () => {
    setup({ quota: 2, created: 1 });
    await screen.findAllByTestId('create-pill');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByTestId<HTMLButtonElement>('create-pill').every((b) => !b.disabled)).toBe(true);
  });

  it.each([390, 1280])(
    'pin, confirm: the picker is gone, the bar hides while pinning, and the form opens in the shared shell (%i px)',
    async (width) => {
      window.innerWidth = width;
      const { setPlacing, onclose } = setup();
      const user = userEvent.setup();
      await user.click(await screen.findByText('Baum erfassen'));
      expect(screen.queryByTestId('create-picker')).toBeNull();
      expect(setPlacing).toHaveBeenLastCalledWith(true);
      await user.click(screen.getByTestId('placement-confirm'));
      expect(setPlacing).toHaveBeenLastCalledWith(false);
      const shell = await screen.findByTestId('form-shell');
      expect(shell.getAttribute('aria-label')).toBe('Baum erfassen');
      expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Baum');
      expect(onclose).not.toHaveBeenCalled(); // the slot stays until the form is over
    },
  );

  it('without a map a point type opens the form at once (the list stands in)', async () => {
    setup({ map: false });
    await userEvent.setup().click(await screen.findByText('Baum erfassen'));
    expect(await screen.findByTestId('form-shell')).toBeTruthy();
  });

  it('cancelling the pin closes the slot', async () => {
    const { onclose } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByText('Baum erfassen'));
    await user.click(screen.getByTestId('placement-cancel'));
    await waitFor(() => expect(onclose).toHaveBeenCalled());
  });

  it('a pick tells the shell a form is open (the + turns back); the form stays when the picker is dismissed over it', async () => {
    const { setForm, onclose, view, ctx } = setup({ map: false });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Baum erfassen'));
    expect(setForm).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId('form-shell')).toBeTruthy();
    expect(screen.queryByTestId('create-picker')).toBeNull();
    // the + pressed with the form open: the shell shows the picker again, over the form
    await view.rerender({ ctx: { ...ctx, pickerShown: true } as never });
    await screen.findByTestId('create-picker');
    await user.click(screen.getByLabelText('Menü schließen')); // the backdrop
    expect(onclose).not.toHaveBeenCalled(); // the form is not closed with the picker
    expect(setForm).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('form-shell')).toBeTruthy();
  });

  it("the pin reaches the run as the type's geometry property (primaryGeometry from the config)", async () => {
    const { submit } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByText('Baum erfassen'));
    await user.click(screen.getByTestId('placement-confirm'));
    await screen.findByTestId('form-shell');
    await user.click(document.getElementById('ub-field-vitalitaet') as HTMLElement);
    await user.click(await screen.findByText('2'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const run = submit.mock.calls[0]?.[0] as { task: string; input: Record<string, unknown> };
    expect(run.task).toBe('erfassen');
    // the property comes from the config's primaryGeometry (`geometrie` of the type baum), not from the slot
    expect(run.input['geometrie']).toEqual({ type: 'Point', coordinates: [7.1, 50.1] });
  });

  it('a type without a geometry starts with nothing and still opens and submits', async () => {
    const { submit } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByText('Baumart anlegen'));
    await screen.findByTestId('form-shell');
    await user.type(await waitFor(() => document.getElementById('ub-field-name_de') as HTMLElement), 'Linde');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const run = submit.mock.calls[0]?.[0] as { task: string; input: Record<string, unknown> };
    expect(run.task).toBe('baumart_anlegen');
    expect(run.input['name_de']).toBe('Linde');
    expect(Object.keys(run.input)).not.toContain('geometrie');
  });

  describe('after Absenden (WP-680, v3 +page.svelte:2321-2359)', () => {
    const axeViolations = async (): Promise<string[]> =>
      (
        await axe.run(document.body, {
          rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
        })
      ).violations.map((v) => v.id);
    async function fillAndSubmit(withAxe = false): Promise<void> {
      const user = userEvent.setup();
      await user.click(await screen.findByText('Baum erfassen'));
      await user.click(screen.getByTestId('placement-confirm'));
      await screen.findByTestId('form-shell');
      if (withAxe) expect(await axeViolations()).toEqual([]);
      await user.click(document.getElementById('ub-field-vitalitaet') as HTMLElement);
      await user.click(await screen.findByText('2'));
      await user.click(screen.getByRole('button', { name: 'Submit' }));
    }

    it.each([390, 1280])(
      'an accepted run closes the form and opens the feature the run created (%i px)',
      async (width) => {
        window.innerWidth = width;
        const { ctx, submit, filter } = setup({ hiddenType: true });
        await fillAndSubmit(true);
        await waitFor(() => expect(ctx.openFeature).toHaveBeenCalledTimes(1));
        const run = submit.mock.calls[0]?.[0] as { featureId?: string };
        expect(run.featureId).toBeTruthy();
        expect(ctx.openFeature).toHaveBeenCalledWith(run.featureId); // from the run, no second lookup
        expect(filter.state().hiddenTypes.has('baum' as Key)).toBe(false); // revealed as v3 did
        expect(
          filter
            .state()
            .hiddenValues.get('baum' as Key)
            ?.has('erfasst'),
        ).toBe(true); // hidden stages stay (v3 :1964-1982)
      },
    );

    it('a type that was not hidden leaves the switches untouched', async () => {
      const { ctx, filter } = setup();
      const ring = vi.fn();
      filter.subscribe(ring);
      await fillAndSubmit();
      await waitFor(() => expect(ctx.openFeature).toHaveBeenCalled());
      expect(ring).not.toHaveBeenCalled();
    });

    it('offline the form closes at once and the feature opens, as v3', async () => {
      const { ctx } = setup({ online: false });
      await fillAndSubmit();
      await waitFor(() => expect(ctx.openFeature).toHaveBeenCalledTimes(1));
    });

    it('a refused run keeps the form open and opens nothing', async () => {
      const { ctx, filter } = setup({ result: 'refused', hiddenType: true });
      await fillAndSubmit();
      await waitFor(() => expect(screen.getByText(/Nicht erlaubt/)).toBeTruthy());
      expect(screen.getByTestId('form-shell')).toBeTruthy();
      expect(ctx.openFeature).not.toHaveBeenCalled();
      expect(filter.state().hiddenTypes.has('baum' as Key)).toBe(true);
    });

    it('cancelling selects nothing', async () => {
      const { ctx, onclose } = setup();
      const user = userEvent.setup();
      await user.click(await screen.findByText('Baum erfassen'));
      await user.click(screen.getByTestId('placement-cancel'));
      await waitFor(() => expect(onclose).toHaveBeenCalled());
      expect(ctx.openFeature).not.toHaveBeenCalled();
    });

    describe('a task with no map position (on: $none, WP-681)', () => {
      async function fillSpecies(withAxe = false): Promise<void> {
        const user = userEvent.setup();
        await user.click(await screen.findByText('Baumart anlegen'));
        await screen.findByTestId('form-shell');
        if (withAxe) expect(await axeViolations()).toEqual([]);
        await user.type(
          await waitFor(() => document.getElementById('ub-field-name_de') as HTMLElement),
          'Linde',
        );
        await user.click(screen.getByRole('button', { name: 'Submit' }));
      }

      it.each([390, 1280])(
        'opens the feature the queue says the run created, and reveals its type flag only (%i px)',
        async (width) => {
          window.innerWidth = width;
          const { ctx, submit, filter, NEW_SPECIES } = setup({ hiddenType: true, hiddenOf: 'baumart' });
          await fillSpecies(true);
          await waitFor(() => expect(ctx.openFeature).toHaveBeenCalledTimes(1));
          expect((submit.mock.calls[0]?.[0] as { featureId?: string }).featureId).toBeUndefined(); // nothing minted here
          expect(ctx.openFeature).toHaveBeenCalledWith(NEW_SPECIES);
          expect(filter.state().hiddenTypes.has('baumart' as Key)).toBe(false);
          expect(
            filter
              .state()
              .hiddenValues.get('baumart' as Key)
              ?.has('erfasst'),
          ).toBe(true); // hidden stages stay, as for a create on the map
        },
      );

      it('offline the form closes at once and the feature opens', async () => {
        const { ctx, NEW_SPECIES } = setup({ online: false });
        await fillSpecies();
        await waitFor(() => expect(ctx.openFeature).toHaveBeenCalledWith(NEW_SPECIES));
      });

      it('a plan that created nothing opens nothing, the form still closes', async () => {
        const { ctx, onclose } = setup({ createsNothing: true });
        await fillSpecies();
        await waitFor(() => expect(onclose).toHaveBeenCalled());
        expect(ctx.openFeature).not.toHaveBeenCalled();
      });

      it('a refused run keeps the form open and opens nothing', async () => {
        const { ctx } = setup({ result: 'refused' });
        await fillSpecies();
        await waitFor(() => expect(screen.getByText(/Nicht erlaubt/)).toBeTruthy());
        expect(screen.getByTestId('form-shell')).toBeTruthy();
        expect(ctx.openFeature).not.toHaveBeenCalled();
      });
    });
  });
  it('Mit Eltern-Element verketten: the run carries the parent, and the created child opens (WP-677, WP-680)', async () => {
    const { ctx, submit } = setup({ parent: true });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Baum erfassen'));
    await user.click(await screen.findByRole('button', { name: 'Mit Eltern-Element verketten' }));
    await user.click(await screen.findByRole('button', { name: /^Park als Eltern/ }));
    await user.click(screen.getByTestId('placement-confirm'));
    await screen.findByTestId('form-shell');
    await user.click(document.getElementById('ub-field-vitalitaet') as HTMLElement);
    await user.click(await screen.findByText('2'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const run = submit.mock.calls[0]?.[0] as { featureId?: string; input: Record<string, unknown> };
    expect(run.input['flaeche_ref']).toBe(PARENT.id);
    await waitFor(() => expect(ctx.openFeature).toHaveBeenCalledWith(run.featureId)); // the child, not the parent
  });
});
