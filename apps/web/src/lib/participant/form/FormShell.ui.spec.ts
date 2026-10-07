// @vitest-environment jsdom
// WP-643: the task form and the create form sit in v3's one detail shell (35/90 vh on a phone, the 450 px panel from
// 768 px), titled with the Objektart, with the form's sticky footer; the modal Sheet is no longer used by them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import { evalContext } from '../../../../../../packages/ui/src/form/form.testing';
import { stepsWorld, TASK } from '../../../../../../packages/ui/src/form/steps/steps.testing';
import FormShell from './FormShell.svelte';

afterEach(cleanup);
const F1 = 'f1' as FeatureId;
const width = (w: number) => {
  window.innerWidth = w;
};
beforeEach(() => width(390));

function device(def: Parameters<typeof stepsWorld>[0]) {
  const { config } = stepsWorld(def);
  const submit = vi.fn(async () => 'queued' as const);
  const kept = new Map<string, Record<string, never>>();
  const dev = {
    config,
    actor: { id: 'u1', kind: 'participant', roles: ['kontrolle'] },
    roleKey: 'kontrolle',
    geo: {},
    blobs: {},
    store: { featureIdsOfType: () => [] },
    feature: () => ({ id: F1, type: 'baum', properties: {}, lifecycle: 'active', updatedSeq: 1 }),
    reader: { taskBinds: () => new Map(), taskContext: () => evalContext(config, {}), labelOf: () => '' },
    // like the device queue: the first progress of a stored run is "queued"
    submitter: {
      submit,
      outcome: (_id: string, l: (p: { state: string }) => void) => {
        l({ state: 'queued' });
        return () => undefined;
      },
    },
    ids: { runId: () => '018f0000-0000-7000-8000-000000000001' },
    drafts: {
      get: async (k: string) => kept.get(k),
      put: async (k: string, v: Record<string, never>) => void kept.set(k, v),
      drop: async (k: string) => void kept.delete(k),
    },
  };
  return { dev, submit };
}
const shell = (dev: unknown, extra: Record<string, unknown> = {}) =>
  render(FormShell, {
    device: dev as never,
    taskKey: TASK,
    featureIds: [F1],
    locale: 'de',
    online: true,
    center: () => undefined,
    onclose: () => undefined,
    ...extra,
  });

describe('form in the shared shell', () => {
  it('is the module shell, titled with the Objektart and named by the task; no modal sheet', async () => {
    const { dev } = device({ form: { befund: {} } });
    shell(dev);
    await screen.findByLabelText(/Befund/);
    const dialog = screen.getByRole('dialog', { name: 'Pflege' });
    expect(dialog.dataset['testid']).toBe('form-shell');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Baum');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it('a creating task is titled with the Objektart it creates', async () => {
    const { dev } = device({ form: { befund: {} } });
    shell(dev, { featureIds: [] });
    await screen.findByLabelText(/Befund/);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Baum');
  });

  it('phone: opens full height (90 vh), tap-toggle to the 35 vh peek; desktop: the 450 px panel', async () => {
    const { dev } = device({ form: { befund: {} } });
    const { unmount } = shell(dev);
    await screen.findByLabelText(/Befund/);
    const d = screen.getByTestId('form-shell');
    expect(d.style.height).toBe('90vh');
    unmount();
    width(1280);
    shell(dev);
    await screen.findByLabelText(/Befund/);
    expect(screen.getByTestId('form-shell').className).toContain('w-[450px]');
  });

  it('keeps v3 footer: Cancel closes with a slide-out, then tells the host', async () => {
    const { dev } = device({ form: { befund: {} } });
    const onclose = vi.fn();
    shell(dev, { onclose });
    await screen.findByLabelText(/Befund/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    // still mounted and shown closed: it slides out
    expect(screen.getByTestId('form-shell').dataset['open']).toBe('false');
    expect(onclose).not.toHaveBeenCalled();
    await waitFor(() => expect(onclose).toHaveBeenCalledTimes(1), { timeout: 1500 });
  });

  it('the X closes it the same way', async () => {
    const { dev } = device({ form: { befund: {} } });
    const onclose = vi.fn();
    shell(dev, { onclose });
    await screen.findByLabelText(/Befund/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schließen' }));
    expect(screen.getByTestId('form-shell').dataset['open']).toBe('false');
    await waitFor(() => expect(onclose).toHaveBeenCalledTimes(1), { timeout: 1500 });
  });

  it('shown=false hides it without unmounting (the map is in use); the values stay', async () => {
    const { dev } = device({ form: { befund: {} } });
    const { rerender } = shell(dev);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Befund/), 'gesund');
    await rerender({ shown: false });
    expect(screen.getByTestId('form-shell').dataset['open']).toBe('false');
    await rerender({ shown: true });
    expect((screen.getByLabelText(/Befund/) as HTMLInputElement).value).toBe('gesund');
  });

  it('a refusal the device makes at once (v3 TaskRunRejectedError) shows the red "Nicht möglich" box, drops the draft and keeps the form open', async () => {
    const { dev, submit } = device({ form: { befund: {} } });
    const discard = vi.fn(async () => undefined);
    (dev as unknown as { queue: unknown }).queue = { discard };
    dev.submitter.outcome = ((_id: string, l: (p: { state: string; reason?: string }) => void) => {
      l({ state: 'refused', reason: 'zu alt' });
      return () => undefined;
    }) as never;
    const onclose = vi.fn();
    shell(dev, { onclose });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Befund/), 'gesund');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const box = await screen.findByTestId('run-local-refusal');
    expect(box.textContent).toContain('Nicht möglich');
    expect(box.textContent).toContain('zu alt');
    expect(screen.queryByText(/Der Server hat/)).toBeNull();
    expect(discard).toHaveBeenCalledTimes(1);
    // the form stays open with what was typed; Schließen closes only the box
    expect(((await screen.findByLabelText(/Befund/)) as HTMLInputElement).value).toBe('gesund');
    await user.click(within(box).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByTestId('run-local-refusal')).toBeNull();
    expect(onclose).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'online=%s: submit closes once the run is stored, without waiting for the server (v3)',
    async (online) => {
      const { dev } = device({ form: { befund: {} } });
      const onclose = vi.fn();
      shell(dev, { onclose, online });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText(/Befund/), 'gesund');
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => expect(onclose).toHaveBeenCalledTimes(1), { timeout: 1500 });
    },
  );

  it('initial values (the pin of the + flow) open the form filled, and are sent with the run', async () => {
    const { dev, submit } = device({ form: { befund: {} } });
    shell(dev, { featureIds: [], initial: { befund: 'vom Pin' } });
    expect(((await screen.findByLabelText(/Befund/)) as HTMLInputElement).value).toBe('vom Pin');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(submit.mock.calls[0])).toContain('vom Pin');
  });

  it('an old draft of the task does not hide the position just placed', async () => {
    const { dev } = device({ form: { befund: {} } });
    await dev.drafts.put('pflege', { befund: 'alt' } as never);
    shell(dev, { featureIds: [], initial: { befund: 'neu' } });
    expect(((await screen.findByLabelText(/Befund/)) as HTMLInputElement).value).toBe('neu');
  });
});
