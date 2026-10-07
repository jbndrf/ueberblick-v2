// @vitest-environment jsdom
// WP-636: "Schritt n von m". A form + location task walks both steps and submits ONE run; a quick-edit step edits only
// the picked properties and an emptied value clears; the location step goes through the map port.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, Key } from '@ueberblick/core/model';
import { axeViolations } from '../../testing/axe';
import { fakeIds, fakeSubmitter } from '../../task-sheet/testing/ports';
import { SubmitRefusedError, type RunDraft } from '../../task-sheet/contract';
import type { Json } from '../contract';
import type { LocationPicker, StepFlowProps, StepView } from './contract';
import StepFlow from './StepFlow.svelte';
import { labels, point, TASK, viewsOf } from './steps.testing';

afterEach(() => {
  cleanup();
  // the clearing dialog locks the page while open
  document.body.removeAttribute('style');
});

const F1 = 'f1' as FeatureId;
const careForm = { befund: { required: true } };

function setup(steps: StepView[], over: Partial<StepFlowProps> = {}) {
  const submitter = fakeSubmitter();
  const onclose = vi.fn();
  const props: StepFlowProps = {
    taskKey: TASK as Key,
    steps,
    labels,
    ids: fakeIds(),
    submitter,
    featureIds: [F1],
    online: true,
    onclose,
    ...over,
  };
  const view = render(StepFlow, props);
  return { submitter, onclose, view, user: userEvent.setup() };
}
const run = (s: { submitted: RunDraft[] }): RunDraft => s.submitted[0] as RunDraft;
const picker = (geometry: Json | undefined): LocationPicker => vi.fn(async () => geometry);

describe('form + location', () => {
  const steps = () =>
    viewsOf({ form: careForm, steps: [{ kind: 'form' }, { kind: 'location', property: 'lage' }] });

  it('walks both steps and submits one run with the values of both', async () => {
    const pick = picker(point(2));
    const { submitter, user } = setup(steps(), { pickLocation: pick });
    expect(screen.getByTestId('step-label').textContent).toBe('Schritt 1 von 2');
    await user.type(await screen.findByLabelText(/Befund/), 'gesund');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByTestId('step-label').textContent).toBe('Schritt 2 von 2');
    // the map opens by itself when the location step is reached (v3: straight to the map)
    await waitFor(() => expect(pick).toHaveBeenCalledTimes(1));
    expect(pick).toHaveBeenCalledWith({ property: 'lage', label: 'Lage', current: undefined });
    await screen.findByText('Standort gewählt');
    expect(submitter.submitted).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    expect(run(submitter)).toMatchObject({
      task: TASK,
      featureId: F1,
      input: { befund: 'gesund', lage: point(2) },
    });
    expect(await screen.findByText('Gespeichert, wird gesendet.')).toBeTruthy();
  });

  it('the form step keeps its validation: no way to the next step with a missing required field', async () => {
    const { user } = setup(steps(), { pickLocation: picker(point(2)) });
    await screen.findByLabelText(/Befund/);
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen.getByTestId('step-label').textContent).toBe('Schritt 1 von 2');
  });

  it('Zurück returns to the step before with its values kept', async () => {
    const { user } = setup(steps(), { pickLocation: picker(undefined) });
    await user.type(await screen.findByLabelText(/Befund/), 'gesund');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.click(await screen.findByRole('button', { name: 'Zurück' }));
    expect(((await screen.findByLabelText(/Befund/)) as HTMLInputElement).value).toBe('gesund');
  });

  it('a cancelled map pick keeps the step: not chosen, the submit button waits, pick again works', async () => {
    const pick = vi.fn<LocationPicker>().mockResolvedValueOnce(undefined).mockResolvedValueOnce(point(3));
    const { submitter, user } = setup(viewsOf({ steps: [{ kind: 'location', property: 'lage' }] }), {
      pickLocation: pick,
    });
    await waitFor(() => expect(pick).toHaveBeenCalledTimes(1));
    expect(pick).toHaveBeenCalledWith({ property: 'lage', label: 'Lage', current: undefined });
    await screen.findByText('Noch kein Standort gewählt');
    expect((screen.getByRole('button', { name: 'Absenden' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Standort auf der Karte wählen' }));
    await screen.findByText('Standort gewählt');
    await user.click(screen.getByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(run(submitter).input).toEqual({ lage: point(3) }));
    // one step: no "Schritt 1 von 1"
    expect(screen.queryByTestId('step-label')).toBeNull();
  });

  it('without a map the step says so and cannot go on', async () => {
    setup(steps().slice(1));
    expect(await screen.findByText('Die Karte ist hier nicht verfügbar.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Standort auf der Karte wählen' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('quick edit step', () => {
  const steps = () =>
    viewsOf(
      { steps: [{ kind: 'quick_edit', properties: ['art', 'hoehe'] }] },
      { art: 'Linde', hoehe: 12, befund: 'gesund' },
    );

  it('shows only the picked properties', async () => {
    setup(steps());
    expect(await screen.findByLabelText(/Art/)).toBeTruthy();
    expect(screen.getByLabelText(/Höhe/)).toBeTruthy();
    expect(screen.queryByLabelText(/Befund/)).toBeNull();
  });

  it('an emptied value is submitted as an explicit null after the warning', async () => {
    const { submitter, user } = setup(steps());
    await user.clear(await screen.findByLabelText(/Art/));
    await user.click(screen.getByRole('button', { name: 'Absenden' }));
    await user.click(await screen.findByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    expect(run(submitter).input).toMatchObject({ art: null });
  });
});

// WP-730: editing an existing feature (v3 LocationEditTool starts at the stored position; the quick edit task of v3 had no
// confirmation, the field `confirm` is asked at the submit of a multi-step task)
describe('edit of an existing feature: quick edit + location', () => {
  const edit = () =>
    viewsOf(
      {
        steps: [
          { kind: 'quick_edit', properties: ['art'] },
          { kind: 'location', property: 'lage' },
        ],
      },
      { art: 'Linde', lage: point(1) },
    );
  const confirm = {
    title: 'Bearbeiten',
    text: 'Änderungen speichern?',
    cancel: 'Abbrechen',
    go: 'Fortfahren',
  };

  it('the location step starts at the stored geometry: it is chosen, not "Noch kein Standort gewählt"', async () => {
    const pick = picker(undefined); // the person closes the map without moving anything
    const { user } = setup(edit(), { pickLocation: pick });
    await user.click(await screen.findByRole('button', { name: 'Weiter' }));
    await waitFor(() =>
      expect(pick).toHaveBeenCalledWith({ property: 'lage', label: 'Lage', current: point(1) }),
    );
    expect(await screen.findByText('Standort gewählt')).toBeTruthy();
    expect(screen.queryByText('Noch kein Standort gewählt')).toBeNull();
  });

  it('an unchanged location writes no geometry (map closed without a change)', async () => {
    const { submitter, user } = setup(edit(), { pickLocation: picker(undefined) });
    await user.click(await screen.findByRole('button', { name: 'Weiter' }));
    await user.click(await screen.findByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    expect(run(submitter).input).not.toHaveProperty('lage');
  });

  it('a moved pin writes the geometry', async () => {
    const moved = setup(edit(), { pickLocation: picker(point(2)) });
    await moved.user.click(await screen.findByRole('button', { name: 'Weiter' }));
    await moved.user.click(await screen.findByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(moved.submitter.submitted).toHaveLength(1));
    expect(run(moved.submitter).input).toMatchObject({ lage: point(2) });
  });

  it('a pin moved to A and put back on the original spot sends the original, never A (core drops an equal one)', async () => {
    const pick = vi.fn<LocationPicker>().mockResolvedValueOnce(point(2)).mockResolvedValueOnce(point(1));
    const { submitter, user } = setup(edit(), { pickLocation: pick });
    await user.click(await screen.findByRole('button', { name: 'Weiter' }));
    await user.click(await screen.findByRole('button', { name: /Standort/ }));
    await waitFor(() => expect(pick).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    expect(run(submitter).input.lage).toEqual(point(1));
  });

  it('the confirmation is asked at Absenden, not at Weiter, and nothing is sent before it is answered', async () => {
    const { submitter, user } = setup(edit(), { pickLocation: picker(undefined), confirm });
    await user.click(await screen.findByRole('button', { name: 'Weiter' }));
    expect(screen.queryByText('Änderungen speichern?')).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Absenden' }));
    expect(await screen.findByText('Änderungen speichern?')).toBeTruthy();
    expect(submitter.submitted).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Fortfahren' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
  });

  it('answering Abbrechen keeps the person on the last step with nothing sent', async () => {
    const { submitter, user } = setup(edit(), { pickLocation: picker(undefined), confirm });
    await user.click(await screen.findByRole('button', { name: 'Weiter' }));
    await user.click(await screen.findByRole('button', { name: 'Absenden' }));
    await user.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    expect(submitter.submitted).toHaveLength(0);
    expect(screen.getByTestId('step-label').textContent).toBe('Schritt 2 von 2');
  });
});

describe('outcome', () => {
  it('a refused run says why and Erneut bearbeiten returns to the last step with the values', async () => {
    const { submitter, user } = setup(viewsOf({ form: careForm }));
    await user.type(await screen.findByLabelText(/Befund/), 'x');
    await user.click(screen.getByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    submitter.push(run(submitter).id, { state: 'refused', reason: 'zu kurz' });
    expect(await screen.findByText('Abgelehnt: zu kurz')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Erneut bearbeiten' }));
    expect(((await screen.findByLabelText(/Befund/)) as HTMLInputElement).value).toBe('x');
  });

  it('has no axe violations on a step', async () => {
    const { view } = setup(
      viewsOf({ form: careForm, steps: [{ kind: 'form' }, { kind: 'location', property: 'lage' }] }),
    );
    await screen.findByLabelText(/Befund/);
    expect(await axeViolations(view.container)).toEqual([]);
  });
});

describe('a submit that fails', () => {
  const steps = () => viewsOf({ steps: [{ kind: 'quick_edit', properties: ['art'] }] }, { art: 'Linde' });
  const fail = async (error: Error) => {
    const { submitter, user } = setup(steps());
    submitter.submit = async () => {
      throw error;
    };
    await user.type(await screen.findByLabelText(/Art/), 'x');
    await user.click(screen.getByRole('button', { name: 'Absenden' }));
  };

  it('a refusal the submitter explains itself shows no generic save-failed line', async () => {
    await fail(new SubmitRefusedError('Nicht erlaubt.'));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Absenden' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.queryByText(labels.saveFailed)).toBeNull();
  });

  it('a storage failure shows the generic line', async () => {
    await fail(new Error('disk full'));
    expect(await screen.findByText(labels.saveFailed)).toBeTruthy();
  });
});
