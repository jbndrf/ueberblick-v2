// @vitest-environment jsdom
// v3's run notices at the top of the feature sheet (TaskRunNotices.svelte): this Objekt's refused runs with
// "Erneut senden" / "Verwerfen" (the queue's own actions), and how many runs still wait.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import { fakeDevice, storedRun } from '../../sheets/settings/fake-device.testing';
import FeatureNotices from './FeatureNotices.svelte';

afterEach(cleanup);
const here = 'm1' as FeatureId;
const label = (key: string): string => (key === 'kontrolle' ? 'Kontrolle' : key);
const refusal = { code: 'constraint_failed', message: 'Zu hoch', path: 'form.hoehe' } as never;

function mount(runs: ReturnType<typeof storedRun>[]) {
  const { device, calls } = fakeDevice(runs);
  render(FeatureNotices, {
    device,
    featureId: here,
    locale: 'de',
    taskLabel: label,
    fieldLabel: (_task: string, f: string) => (f === 'hoehe' ? 'Höhe' : undefined),
  });
  return calls;
}

describe('run notices on the feature sheet', () => {
  it('shows nothing when this Objekt has no run to report', async () => {
    mount([storedRun('r1', 1, 'refused', { featureId: 'other', refusal })]);
    await waitFor(() => expect(screen.queryByTestId('run-refused')).toBeNull());
    expect(screen.queryByTestId('run-pending')).toBeNull();
  });

  it('lists the refused runs of this Objekt only, with the task and the reason', async () => {
    mount([
      storedRun('r1', 1, 'refused', { featureId: 'm1', refusal, task: 'kontrolle' }),
      storedRun('r2', 2, 'refused', { featureId: 'other', refusal }),
    ]);
    const box = await screen.findByTestId('run-refused');
    expect(within(box).getAllByRole('listitem')).toHaveLength(1);
    expect(box.textContent).toContain('Kontrolle');
    expect(box.textContent).toContain('Ein Wert ist ungültig. Feld: Höhe'); // the sentence, not the code
    expect(box.textContent).not.toContain('Zu hoch');
    expect(box.textContent).not.toContain('constraint_failed');
  });

  it('Erneut senden resubmits the run and Verwerfen discards it, through the queue', async () => {
    const calls = mount([storedRun('r1', 1, 'refused', { featureId: 'm1', refusal })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Erneut senden' }));
    expect(calls.resubmit).toHaveBeenCalledWith('r1');
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(calls.discard).toHaveBeenCalledWith('r1');
    await waitFor(() => expect(screen.queryByTestId('run-refused')).toBeNull());
  });

  it('counts the runs that still wait to be sent', async () => {
    mount([
      storedRun('r1', 1, 'queued', { featureId: 'm1' }),
      storedRun('r2', 2, 'queued', { featureId: 'm1' }),
      storedRun('r3', 3, 'queued', { featureId: 'other' }),
    ]);
    expect((await screen.findByTestId('run-pending')).textContent).toContain('Noch nicht übertragen: 2');
  });
});
