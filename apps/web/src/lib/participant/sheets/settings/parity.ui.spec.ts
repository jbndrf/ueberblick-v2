// @vitest-environment jsdom
// WP-649: the Einstellungen sheet matches v3's SettingsSheet (tabs with icons, status card icons, participant card,
// legal dialog, Optionen icons and the language order EN, DE).
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import SettingsSheet from './SettingsSheet.svelte';
import { fakeDevice, memoryStorage, type syncStatus } from './fake-device.testing';
import { createDevicePrefs } from './prefs';
import type { SettingsDevice } from './device';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const icon = (root: ParentNode, name: string) => root.querySelector(`svg.lucide-${name}`);

type Identity = Partial<SettingsDevice['identity']>;
const legalPages = [
  {
    slug: 'impressum',
    title: 'Impressum',
    body: '<h2>Kopf</h2><p>Text <script>alert(1)</script>impressum</p>',
  },
  { slug: 'datenschutz', title: 'Datenschutz', body: '<h2>Kopf</h2><p>Text datenschutz</p>' },
];

function mount(
  over: {
    online?: boolean;
    identity?: Identity;
    sync?: ReturnType<typeof syncStatus>;
    locale?: 'de' | 'en';
    offline?: boolean;
    roleLabel?: (key: string) => string;
  } = {},
) {
  const { device, calls } = fakeDevice([], over.sync, over.identity);
  const offline = createRawSnippet(() => ({ render: () => '<p data-testid="offline-slot">slot</p>' }));
  const view = render(SettingsSheet, {
    open: true,
    device,
    locale: over.locale ?? 'de',
    prefs: createDevicePrefs({ storage: memoryStorage(), prefersDark: () => false, deviceLocale: 'de' }),
    online: over.online ?? true,
    taskLabel: (k: string) => k,
    roleLabel: over.roleLabel ?? ((k: string) => k),
    onjump: vi.fn(),
    onsignout: vi.fn(async () => true),
    onlocale: vi.fn(),
    ...(over.offline === true ? { offline } : {}),
  });
  return { ...view, calls };
}

describe('tabs (v3 SettingsSheet.svelte:384-399)', () => {
  it('Profil, Optionen and Offline carry the User, SlidersHorizontal and HardDrive icons', () => {
    mount();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Profil', 'Optionen', 'Offline']);
    const [profile, options, offline] = tabs as [HTMLElement, HTMLElement, HTMLElement];
    expect(icon(profile, 'user')).toBeTruthy();
    expect(icon(options, 'sliders-horizontal')).toBeTruthy();
    expect(icon(offline, 'hard-drive')).toBeTruthy();
  });

  it('the Offline tab shows the slot WP-650 fills, and a plain notice until then', async () => {
    mount({ offline: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Offline' }));
    expect(await screen.findByTestId('offline-slot')).toBeTruthy();
    cleanup();
    localStorage.clear();
    mount();
    await userEvent.click(screen.getByRole('tab', { name: 'Offline' }));
    expect(await screen.findByTestId('offline-pending')).toBeTruthy();
  });

  it('remembers the last tab across a reopen, as v3 createPersistedTab', async () => {
    mount();
    await userEvent.click(screen.getByRole('tab', { name: 'Optionen' }));
    cleanup();
    mount();
    expect(screen.getByRole('tab', { name: 'Optionen' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Profil icons (v3 :401-470)', () => {
  it('the online card has the Wifi icon, the offline card WifiOff', () => {
    const view = mount();
    expect(icon(screen.getByTestId('sync-card'), 'wifi')).toBeTruthy();
    expect(icon(screen.getByTestId('sync-card'), 'wifi-off')).toBeNull();
    view.unmount();
    mount({ online: false });
    expect(icon(screen.getByTestId('sync-card'), 'wifi-off')).toBeTruthy();
  });

  it('"Jetzt synchronisieren" has the cloud icon and, while syncing, a spinner', async () => {
    const { calls } = mount();
    const button = screen.getByRole('button', { name: 'Jetzt synchronisieren' });
    expect(icon(button, 'cloud-upload')).toBeTruthy();
    calls.syncNow.mockImplementation(() => new Promise(() => undefined));
    await fireEvent.click(button);
    const busy = await screen.findByRole('button', { name: /synchronisiert/ });
    expect(busy.querySelector('svg.animate-spin')).toBeTruthy();
  });

  it('the participant card shows the name with the User icon; Abmelden has the LogOut icon', () => {
    mount();
    const card = screen.getByTestId('participant-card');
    expect(within(card).getByText('Anna')).toBeTruthy();
    expect(icon(card, 'user')).toBeTruthy();
    expect(icon(within(card).getByRole('button', { name: 'Abmelden' }), 'log-out')).toBeTruthy();
  });

  it('the roles card has the Shield icon', () => {
    mount();
    const card = screen.getByTestId('roles-card');
    expect(icon(card, 'shield')).toBeTruthy();
    expect(within(card).getByText('pruefer')).toBeTruthy();
  });
});

describe('roles (WP-713)', () => {
  it('shows the role as the project names it, never its key', () => {
    mount({ roleLabel: (k) => (k === 'pruefer' ? 'Prüfer' : k) });
    const card = screen.getByTestId('roles-card');
    expect(within(card).getByText('Prüfer')).toBeTruthy();
    expect(within(card).queryByText('pruefer')).toBeNull();
  });
});

describe('Rechtliches (v3 :537-552, 898-918), from the cached bootstrap', () => {
  it('lists the legal pages under the heading, each opening the dialog with its text', async () => {
    mount({ identity: { legalPages } });
    expect(await screen.findByText('Rechtliches')).toBeTruthy();
    await fireEvent.click(await screen.findByRole('button', { name: 'Impressum' }));
    const dialog = await screen.findByRole('dialog', { name: 'Impressum' });
    await within(dialog).findByText('Kopf');
    expect(dialog.className).toContain('max-h-[80vh]');
    expect(dialog.className).toContain('sm:max-w-lg');
  });

  it('the page text is sanitised: no script survives', async () => {
    mount({ identity: { legalPages } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Impressum' }));
    const dialog = await screen.findByRole('dialog', { name: 'Impressum' });
    await within(dialog).findByText('Kopf');
    expect(dialog.querySelector('script')).toBeNull();
  });

  it('shows no heading without legal pages', () => {
    mount();
    expect(screen.queryByText('Rechtliches')).toBeNull();
  });
});

describe('Optionen icons and language order (v3 theme-toggle-inline, font-size-inline, language-selector-inline)', () => {
  it('Sun or Moon follows the theme, ALargeSmall labels the size, Languages the language; EN comes before DE', async () => {
    mount();
    await userEvent.click(screen.getByRole('tab', { name: 'Optionen' }));
    const theme = await screen.findByRole('group', { name: 'Darstellung' });
    expect(icon(theme, 'sun')).toBeTruthy();
    expect(icon(within(theme).getByRole('button', { name: 'Dunkel' }), 'moon')).toBeTruthy();
    await fireEvent.click(within(theme).getByRole('button', { name: 'Dunkel' }));
    await waitFor(() => expect(icon(theme.firstElementChild as Element, 'moon')).toBeTruthy());
    expect(icon(screen.getByRole('group', { name: 'Schriftgröße' }), 'a-large-small')).toBeTruthy();
    const language = screen.getByRole('group', { name: 'Sprache' });
    expect(icon(language, 'languages')).toBeTruthy();
    expect(
      within(language)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim()),
    ).toEqual(['EN', 'DE']);
  });
});

describe('the sheet stays accessible with the new parts', () => {
  it('has no axe violations on Profil with legal pages', async () => {
    mount({ identity: { legalPages } });
    await screen.findByRole('button', { name: 'Impressum' });
    expect(await axeViolations(await screen.findByRole('dialog'))).toEqual([]);
  });
});
