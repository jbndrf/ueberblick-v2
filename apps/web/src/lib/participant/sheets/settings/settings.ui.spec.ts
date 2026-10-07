// @vitest-environment jsdom
// The Einstellungen sheet replays v3's journey (SettingsSheet.svelte, TaskRunQueueList, TaskRunNotices): Profil shows
// the connection, the last sync and the queue; a row jumps to its Objekt; Abmelden keeps unsent runs and warns first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import RunNotices from './RunNotices.svelte';
import SettingsSheet from './SettingsSheet.svelte';
import { fakeDevice, memoryStorage, storedRun, syncStatus } from './fake-device.testing';
import { createDevicePrefs } from './prefs';
import { queueRows } from './queue-rows';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.fontSize = '';
});

const refusal = { code: 'not_permitted', message: 'Not allowed' };
const runs = () => [
  storedRun('r1', 1, 'queued', { featureId: 'f1', task: 'inspect' }),
  storedRun('r2', 2, 'refused', { featureId: 'f2', task: 'repair', refusal }),
];

function mount(
  over: {
    problems?: Parameters<typeof fakeDevice>[4];
    runs?: ReturnType<typeof runs>;
    online?: boolean;
    storage?: ReturnType<typeof memoryStorage>;
    sync?: ReturnType<typeof syncStatus>;
  } = {},
) {
  const { device, calls } = fakeDevice(over.runs ?? runs(), over.sync, {}, null, over.problems);
  const storage = over.storage ?? memoryStorage();
  const handlers = { onjump: vi.fn(), onsignout: vi.fn(async () => true), onlocale: vi.fn() };
  const view = render(SettingsSheet, {
    open: true,
    device,
    locale: 'en',
    prefs: createDevicePrefs({ storage, prefersDark: () => false, deviceLocale: 'de' }),
    online: over.online ?? true,
    taskLabel: (k: string) => `Task ${k}`,
    roleLabel: (k: string) => k,
    ...handlers,
  });
  return { ...view, calls, handlers, storage };
}

describe('a fault of the sync host (WP-656)', () => {
  it('shows on the Profil sync card, where v3 shows a failed sync (SettingsSheet.svelte:456-457)', async () => {
    mount({ problems: [{ code: 'stale_bundle', subject: 'host', detail: 'bad_version' }] });
    const card = await screen.findByTestId('sync-card');
    expect(within(card).getByText(/Please reload the page/)).toBeTruthy();
  });
});

describe('a dependent run (WP-767)', () => {
  it('shows v3 badge and text; its title does not jump while the Objekt is not on the device', async () => {
    const dep = [storedRun('r3', 3, 'dependent', { featureId: 'gone', task: 'repair', refusal })];
    const { device } = fakeDevice(dep, undefined, {}, null, [], () => false);
    render(SettingsSheet, {
      open: true,
      device,
      locale: 'de',
      prefs: createDevicePrefs({ storage: memoryStorage(), prefersDark: () => false, deviceLocale: 'de' }),
      online: true,
      taskLabel: (k: string) => `Task ${k}`,
      roleLabel: (k: string) => k,
      onjump: vi.fn(),
      onsignout: vi.fn(),
      onlocale: vi.fn(),
    });
    await screen.findByText('Folgeänderung abgelehnt');
    expect(screen.getByText(/Beruht auf einer abgelehnten Änderung\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Task repair/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Erneut senden' })).toBeTruthy();
  });

  it('follows the device: a row jumps while its Objekt is on the device and stops when the create leaves it (WP-792)', async () => {
    let held = true;
    const dep = [storedRun('r3', 3, 'dependent', { featureId: 'new', task: 'repair', refusal })];
    const { device, ringChanged } = fakeDevice(dep, undefined, {}, null, [], () => held);
    render(SettingsSheet, {
      open: true,
      device,
      locale: 'de',
      prefs: createDevicePrefs({ storage: memoryStorage(), prefersDark: () => false, deviceLocale: 'de' }),
      online: true,
      taskLabel: (k: string) => `Task ${k}`,
      roleLabel: (k: string) => k,
      onjump: vi.fn(),
      onsignout: vi.fn(),
      onlocale: vi.fn(),
    });
    await screen.findByRole('button', { name: /Task repair/ });
    held = false;
    ringChanged();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Task repair/ })).toBeNull());
  });
});

describe('the Einstellungen sheet and the page', () => {
  it('does not lock the rest of the shell: with the sheet open the page keeps taking taps (v3: the bar stays usable)', async () => {
    mount();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
});

describe('Profil', () => {
  it('shows online state, last sync, the pending count and the queue list from the device', async () => {
    mount({ sync: syncStatus({ lastSyncedAt: '2026-10-01T11:55:00Z' }) });
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getByText('Last synced 5 minutes ago')).toBeTruthy();
    expect(await screen.findByText('1 unsaved change(s) waiting to upload.')).toBeTruthy(); // the refused run waits for nothing (v3 countOpenTaskRuns)
    const list = await screen.findByTestId('run-queue');
    expect(within(list).getByText('Task inspect')).toBeTruthy();
    expect(within(list).getByText('Task repair')).toBeTruthy();
    expect(within(list).getByText('You are not allowed to make this change.')).toBeTruthy();
  });

  it('offline: says so, and Sync now is not offered', () => {
    mount({ online: false, runs: [] });
    expect(screen.getByRole('status').textContent).toBe('Offline');
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Never synced on this device')).toBeTruthy();
  });

  it('warns when the data on the device is a week old', () => {
    mount({ runs: [], sync: syncStatus({ lastSyncedAt: '2026-09-20T12:00:00Z' }) });
    expect(screen.getByText('Your data is 11 days old. Connect to refresh.')).toBeTruthy();
  });

  it('Sync now asks the device to sync', async () => {
    const { calls } = mount({ runs: [] });
    await fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(calls.syncNow).toHaveBeenCalledTimes(1));
  });

  it('Send again re-submits a refused run; Discard removes it from the list', async () => {
    const { calls } = mount();
    const row = (await screen.findByTestId('run-queue')).querySelector('[data-run="r2"]') as HTMLElement;
    await fireEvent.click(within(row).getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(calls.resubmit).toHaveBeenCalledWith('r2'));
    await fireEvent.click(within(row).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(calls.discard).toHaveBeenCalledWith('r2'));
    await waitFor(() => expect(screen.queryByText('Task repair')).toBeNull());
  });

  it('a waiting run can be discarded', async () => {
    const { calls } = mount();
    const row = (await screen.findByTestId('run-queue')).querySelector('[data-run="r1"]') as HTMLElement;
    await fireEvent.click(within(row).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(calls.discard).toHaveBeenCalledWith('r1'));
  });

  it('a row jumps to its Objekt on the map and closes the sheet', async () => {
    const { handlers } = mount();
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Show the object on the map: Task repair' }),
    );
    expect(handlers.onjump).toHaveBeenCalledWith('f2');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Abmelden', () => {
  it('offline it says so and keeps the session and the sheet (WP-769)', async () => {
    const { handlers } = mount({ runs: [] });
    handlers.onsignout.mockResolvedValue(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByTestId('signout-offline')).textContent).toContain('no connection');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('without unsent runs it signs out at once', async () => {
    const { handlers } = mount({ runs: [] });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(handlers.onsignout).toHaveBeenCalledTimes(1);
  });

  it('with unsent runs it warns that they are lost; Cancel keeps the session', async () => {
    const { handlers } = mount();
    await screen.findByTestId('run-queue');
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('2 change(s) are not sent yet. They are lost when you sign out');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(handlers.onsignout).not.toHaveBeenCalled();
  });

  it('confirming signs out; the runs are not discarded', async () => {
    const { handlers, calls } = mount();
    await screen.findByTestId('run-queue');
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sign out anyway' }),
    );
    expect(handlers.onsignout).toHaveBeenCalledTimes(1);
    expect(calls.discard).not.toHaveBeenCalled();
  });
});

describe('Optionen', () => {
  async function openOptions() {
    const view = mount({ runs: [] });
    await userEvent.click(screen.getByRole('tab', { name: 'Options' }));
    await screen.findByRole('button', { name: 'Dark' });
    return view;
  }

  it('theme and font size apply at once and are stored', async () => {
    const { storage } = await openOptions();
    await fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'XL' }));
    expect(document.documentElement.style.fontSize).toBe('20px');
    expect(storage.getItem('mode-watcher-mode')).toBe('dark');
    expect(storage.getItem('ub:font-size')).toBe('xl');
  });

  it('after a reload the sheet shows what was stored', async () => {
    const storage = memoryStorage({ 'mode-watcher-mode': 'dark', 'ub:font-size': 'small' });
    mount({ runs: [], storage });
    await userEvent.click(screen.getByRole('tab', { name: 'Options' }));
    await screen.findByRole('button', { name: 'Dark' });
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'S' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the language is stored and the host is told', async () => {
    const { storage, handlers } = await openOptions();
    await fireEvent.click(screen.getByRole('button', { name: 'DE' }));
    expect(storage.getItem('ub:locale')).toBe('de');
    expect(handlers.onlocale).toHaveBeenCalledWith('de');
  });
});

describe('the sheet is accessible', () => {
  it('has no axe violations on Profil', async () => {
    mount();
    await screen.findByTestId('run-queue');
    expect(await axeViolations(await screen.findByRole('dialog'))).toEqual([]);
  });
});

describe('data freshness card (WP-678) is accessible at phone and desktop width', () => {
  const states = {
    'never synced': { sync: syncStatus(), text: 'Never synced on this device' },
    'stale (v3: 7 days)': {
      sync: syncStatus({ lastSyncedAt: '2026-09-20T12:00:00Z' }),
      text: 'Your data is 11 days old. Connect to refresh.',
    },
  } as const;
  for (const width of [390, 1280]) {
    for (const [name, state] of Object.entries(states)) {
      it(`${name} at ${width}px has no axe violations`, async () => {
        const before = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        window.dispatchEvent(new Event('resize'));
        try {
          mount({ runs: [], sync: state.sync });
          expect(screen.getByText(state.text)).toBeTruthy();
          expect(await axeViolations(await screen.findByRole('dialog'))).toEqual([]);
        } finally {
          Object.defineProperty(window, 'innerWidth', { configurable: true, value: before });
        }
      });
    }
  }
});

describe('RunNotices (v3 TaskRunNotices)', () => {
  const rows = queueRows(runs(), { sending: undefined }, (k) => `Task ${k}`, 'en');

  it('lists refused runs with Send again / Discard, and counts the waiting ones', () => {
    const onresend = vi.fn();
    const ondiscard = vi.fn();
    render(RunNotices, { rows, locale: 'en', onresend, ondiscard, retrying: true });
    const refused = screen.getByTestId('run-refused');
    fireEvent.click(within(refused).getByRole('button', { name: 'Send again' }));
    fireEvent.click(within(refused).getByRole('button', { name: 'Discard' }));
    expect(onresend).toHaveBeenCalledWith('r2');
    expect(ondiscard).toHaveBeenCalledWith('r2');
    expect(screen.getByTestId('run-pending').textContent).toContain('Not uploaded yet: 1');
    expect(screen.getByTestId('run-pending').textContent).toContain('next attempt follows automatically');
  });

  it('a refused run jumps to its Objekt; with a feature given only its notices show', () => {
    const onjump = vi.fn();
    render(RunNotices, {
      rows,
      locale: 'en',
      featureId: 'f2' as never,
      onjump,
      onresend: vi.fn(),
      ondiscard: vi.fn(),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show the object on the map: Task repair' }));
    expect(onjump).toHaveBeenCalledWith('f2');
    expect(screen.queryByTestId('run-pending')).toBeNull();
  });

  it('shows what the device refused just now, with Dismiss', () => {
    const ondismisslocal = vi.fn();
    render(RunNotices, {
      rows: [],
      locale: 'de',
      localRefusal: 'Ein Pflichtfeld fehlt.',
      onresend: vi.fn(),
      ondiscard: vi.fn(),
      ondismisslocal,
    });
    expect(screen.getByRole('alert').textContent).toContain('Nicht möglich');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(ondismisslocal).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(RunNotices, {
      rows,
      locale: 'en',
      onjump: vi.fn(),
      onresend: vi.fn(),
      ondiscard: vi.fn(),
    });
    expect(await axeViolations(container)).toEqual([]);
  });
});
