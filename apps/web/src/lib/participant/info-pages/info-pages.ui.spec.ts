// @vitest-environment jsdom
// WP-661: Profil lists the project's info pages (v3 SettingsSheet.svelte:516-531); the dialog replaces the login
// variables and draws the QR codes; the e-mail shows on the participant card; all of it comes from the cached identity.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import SettingsSheet from '../sheets/settings/SettingsSheet.svelte';
import { fakeDevice, memoryStorage } from '../sheets/settings/fake-device.testing';
import { createDevicePrefs } from '../sheets/settings/prefs';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const login = { token: 'tok123', link: 'https://x.test/l/tok123' };
const infoPages = [
  {
    key: 'hilfe',
    title: { de: 'Hilfe', en: 'Help' },
    content: { de: '<p>Token $token</p>', en: '<p>Token $token</p>' },
  },
  { key: 'zweit', title: 'Zweites Handy', content: '<p>$loginlink</p>$qrtoken$qrloginlink' },
];

function mount(over: { login?: typeof login | null; email?: string | null; offline?: boolean } = {}) {
  const { device } = fakeDevice(
    [],
    undefined,
    { login: over.login === undefined ? login : over.login, infoPages, legalPages: [] },
    over.email ?? null,
  );
  return render(SettingsSheet, {
    open: true,
    device,
    locale: 'de',
    prefs: createDevicePrefs({ storage: memoryStorage(), prefersDark: () => false, deviceLocale: 'de' }),
    online: !(over.offline ?? false),
    taskLabel: (k: string) => k,
    roleLabel: (k: string) => k,
    onjump: vi.fn(),
    onsignout: vi.fn(async () => true),
    onlocale: vi.fn(),
  });
}

describe('Infoseiten in Profil', () => {
  it('lists the pages in sort order, also offline', async () => {
    mount({ offline: true });
    const names = (await screen.findAllByRole('button')).map((b) => b.textContent?.trim());
    expect(names.indexOf('Hilfe')).toBeGreaterThan(-1);
    expect(names.indexOf('Hilfe')).toBeLessThan(names.indexOf('Zweites Handy'));
  });

  it('the dialog replaces $token and $loginlink', async () => {
    mount();
    await fireEvent.click(await screen.findByRole('button', { name: 'Hilfe' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hilfe' });
    expect(within(dialog).getByText('Token tok123')).toBeTruthy();
  });

  it('draws QR codes that encode the token and the login link', async () => {
    mount();
    await fireEvent.click(await screen.findByRole('button', { name: 'Zweites Handy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zweites Handy' });
    const codes = within(dialog).getAllByTestId('info-qr');
    expect(codes.map((c) => c.getAttribute('data-value'))).toEqual([login.token, login.link]);
    await waitFor(() => expect(codes.every((c) => c.querySelector('svg') !== null)).toBe(true));
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('drops the QR codes when the participant has no login', async () => {
    mount({ login: null });
    await fireEvent.click(await screen.findByRole('button', { name: 'Zweites Handy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zweites Handy' });
    expect(within(dialog).queryAllByTestId('info-qr')).toEqual([]);
  });
});

describe('E-mail on the participant card (v3 :474-478)', () => {
  it('shows the e-mail when present', async () => {
    mount({ email: 'anna@example.org' });
    expect((await screen.findByTestId('participant-email')).textContent).toBe('anna@example.org');
  });
  it('shows nothing for a guest', async () => {
    mount({ email: null });
    await screen.findByTestId('participant-card');
    expect(screen.queryByTestId('participant-email')).toBeNull();
  });
});
