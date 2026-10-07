// @vitest-environment jsdom
// WP-636: the form sheet runs a task with steps as the multi-step flow ("Schritt n von m"), a plain form task as the
// task sheet; the location step asks the map port; the quick edit controller submits the changed properties as one run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, Key } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import { setUiLocale } from '@ueberblick/ui';
import { evalContext } from '../../../../../../packages/ui/src/form/form.testing';
import { point, stepsWorld, TASK } from '../../../../../../packages/ui/src/form/steps/steps.testing';
import { openQuickEdit } from '../feature/quick-edit.svelte';
import { axeViolations } from '@ueberblick/ui/testing';
import FormSheet from './FormSheet.svelte';
import LocaleHarness from './LocaleHarness.testing.svelte';

afterEach(() => {
  cleanup();
  setUiLocale(undefined);
});

const F1 = 'f1' as FeatureId;

function device(def: Parameters<typeof stepsWorld>[0], current: Record<string, unknown> = {}) {
  const { config } = stepsWorld(def);
  const submit = vi.fn(async () => 'queued' as const);
  let n = 0;
  const dev = {
    config,
    actor: { id: 'u1', kind: 'participant', roles: ['kontrolle'] },
    roleKey: 'kontrolle',
    geo: {},
    blobs: {},
    store: { featureIdsOfType: () => [] },
    feature: () => ({ id: F1, type: 'baum', properties: current, lifecycle: 'active', updatedSeq: 1 }),
    reader: {
      taskBinds: () => new Map(),
      taskContext: () => evalContext(config, current as never),
      labelOf: () => '',
    },
    submitter: { submit, outcome: () => () => undefined },
    ids: { runId: () => `018f0000-0000-7000-8000-${String(++n).padStart(12, '0')}` },
    drafts: { get: async () => undefined, put: async () => undefined, drop: async () => undefined },
  };
  return { dev, submit };
}
const sheet = (dev: unknown, extra: Record<string, unknown> = {}) =>
  render(FormSheet, {
    device: dev as never,
    taskKey: TASK,
    featureIds: [F1],
    locale: 'de',
    online: true,
    center: () => undefined,
    onclose: () => undefined,
    ...extra,
  });

describe('form sheet', () => {
  const multi = {
    form: { befund: { required: true } },
    steps: [{ kind: 'form' }, { kind: 'location', property: 'lage' }],
  } as const;

  it('a form + location task shows "Schritt 1 von 2", asks the map and submits one run', async () => {
    const { dev, submit } = device(multi as never);
    const pickLocation = vi.fn(async () => point(4));
    sheet(dev, { pickLocation });
    const user = userEvent.setup();
    expect((await screen.findByTestId('step-label')).textContent).toBe('Schritt 1 von 2');
    await user.type(screen.getByLabelText(/Befund/), 'gesund');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await waitFor(() => expect(pickLocation).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ task: TASK, featureId: F1, input: { befund: 'gesund', lage: point(4) } }),
    );
  });

  it('a language switch re-labels an open multi-step form and keeps what was typed (WP-790)', async () => {
    const { dev } = device(multi as never);
    const view = render(LocaleHarness, {
      device: dev as never,
      taskKey: TASK,
      featureIds: [F1],
      first: 'de',
      online: true,
      center: () => undefined,
      onclose: () => undefined,
      pickLocation: vi.fn(async () => point(4)),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Befund/), 'gesund');
    view.component.switchTo('en');
    expect((await screen.findByTestId('step-label')).textContent).toBe('Step 1 of 2');
    expect((screen.getByLabelText(/Befund/) as HTMLInputElement).value).toBe('gesund');
  });

  it('a language switch re-labels the kit strings of a step view too ("required" mark, WP-829)', async () => {
    setUiLocale('de');
    const { dev } = device(multi as never);
    const view = render(LocaleHarness, {
      device: dev as never,
      taskKey: TASK,
      featureIds: [F1],
      first: 'de',
      online: true,
      center: () => undefined,
      onclose: () => undefined,
      pickLocation: vi.fn(async () => point(4)),
    });
    await screen.findByText('(Pflichtfeld)');
    setUiLocale('en');
    view.component.switchTo('en');
    await screen.findByText('(required)');
    expect(screen.queryByText('(Pflichtfeld)')).toBeNull();
  });

  it('a task with only a form is the plain task sheet: no step label', async () => {
    const { dev } = device({ form: { befund: {} } });
    sheet(dev);
    await screen.findByLabelText(/Befund/);
    expect(screen.queryByTestId('step-label')).toBeNull();
  });
});

describe('quick edit controller', () => {
  const def = { steps: [{ kind: 'quick_edit', properties: ['art', 'hoehe'] }] } as never;
  const current = { art: 'Linde', hoehe: 12, befund: 'gesund' };

  it('shows only the picked properties and submits only what changed, as one run', async () => {
    const { dev, submit } = device(def, current);
    const end = vi.fn();
    const edit = openQuickEdit(dev as never, TASK as Key, F1, 'de', end);
    expect(edit?.fields.map((f) => f.key)).toEqual(['art', 'hoehe']);
    edit?.set('art', 'Eiche');
    await edit?.save();
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ task: TASK, featureId: F1, input: { art: 'Eiche' } }),
    );
    expect(end).toHaveBeenCalled();
  });

  it('emptying a value clears it with an explicit null', async () => {
    const { dev, submit } = device(def, current);
    const edit = openQuickEdit(dev as never, TASK as Key, F1, 'de', () => undefined);
    edit?.set('hoehe', '');
    await edit?.save();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ input: { hoehe: null } }));
  });

  it('nothing changed: no run, the edit just ends', async () => {
    const { dev, submit } = device(def, current);
    const end = vi.fn();
    await openQuickEdit(dev as never, TASK as Key, F1, 'de', end)?.save();
    expect(submit).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it('Abbrechen ends the edit without a run', () => {
    const { dev, submit } = device(def, current);
    const end = vi.fn();
    openQuickEdit(dev as never, TASK as Key, F1, 'de', end)?.cancel();
    expect(end).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('create form with a placed position (WP-697)', () => {
  const create = { form: { befund: { required: true }, lage: { required: true } } } as never;
  const placed = { lage: point(4) };

  it.each([390, 1280])(
    'at %i px: shows no Geometrie row, has no axe violations and submits the position with the run',
    async (w) => {
      window.innerWidth = w;
      window.dispatchEvent(new Event('resize'));
      const { dev, submit } = device(create);
      const view = sheet(dev, { initial: placed });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText(/Befund/), 'gesund');
      expect(screen.queryByText(/Lage/)).toBeNull();
      expect(screen.queryByTestId('field-lage')).toBeNull();
      expect(await axeViolations(view.container)).toEqual([]);
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ befund: 'gesund', lage: point(4) }) }),
      );
    },
  );

  it('a multi-step create keeps the position out of the form step and still submits it', async () => {
    const { dev, submit } = device({
      ...(create as object),
      steps: [{ kind: 'form' }, { kind: 'quick_edit', properties: ['art'] }],
    } as never);
    sheet(dev, { initial: placed });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Befund/), 'ok');
    expect(screen.queryByText(/Lage/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.click(await screen.findByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ lage: point(4) }) }),
    );
  });

  it('without a placed position the geometry stays a row, so a required one is not silently missing', async () => {
    const { dev } = device(create);
    sheet(dev);
    await screen.findByLabelText(/Befund/);
    expect(screen.getAllByText(/Lage/).length).toBeGreaterThan(0);
  });
});
