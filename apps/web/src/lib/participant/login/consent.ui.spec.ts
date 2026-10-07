// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import LoginPage from './LoginPage.svelte';
import { LOCALE_KEY } from './locale';
import type { LoadScanner } from './scanner';

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof matchMedia;
Element.prototype.scrollIntoView ??= () => {};

const catalogue = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../messages', `${locale}.json`),
      'utf8',
    ),
  ) as Record<string, string>;
const de = catalogue('de');

const gate = (over: Record<string, unknown> = {}) => ({
  required: true,
  accepted: false,
  title: 'Datenschutz des Betreibers',
  body: '<p>Wir nutzen <strong>nur</strong> Cookies.</p>',
  acceptLabel: 'Einverstanden',
  rejectLabel: 'Nein',
  footerPages: [{ slug: 'impressum', title: 'Impressum', body: '<p>Betreiber: Stadt X</p>' }],
  ...over,
});

interface World {
  consent: Record<string, unknown>;
  /** Cookie state: the exchange answers 403 until the decision "accepted" was posted. */
  accepted: boolean;
  calls: string[];
}
function world(
  consent: Record<string, unknown>,
): World & { fetch: (url: string, init?: RequestInit) => Promise<Response> } {
  const w: World = { consent, accepted: false, calls: [] };
  const fetch = (url: string, init?: RequestInit): Promise<Response> => {
    const json = (status: number, body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url === '/api/instance/consent' && init?.method === 'POST') {
      const decision = (JSON.parse(String(init.body)) as { decision: string }).decision;
      w.calls.push(`decide:${decision}`);
      w.accepted = decision === 'accepted';
      return json(200, { ok: true });
    }
    if (url === '/api/instance/consent') {
      w.calls.push('consent');
      return json(200, { ...w.consent, accepted: w.accepted });
    }
    w.calls.push('exchange');
    return w.consent['required'] && !w.accepted ? json(403, { code: 'consent_required' }) : json(200, {});
  };
  return Object.assign(w, { fetch });
}

function mount(w: ReturnType<typeof world>, search = '') {
  localStorage.setItem(LOCALE_KEY, 'de');
  history.replaceState(null, '', `/login${search}`);
  const go = vi.fn();
  const leave = vi.fn();
  const load: LoadScanner = vi.fn(() => Promise.reject(new Error('no scanner')));
  return { ...render(LoginPage, { fetch: w.fetch, load, go, leave }), go, leave };
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('consent modal on /login (WP-638)', () => {
  it('shows the configured title, body and labels with the footer pages; nothing is submitted yet', async () => {
    const w = world(gate());
    mount(w);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Datenschutz des Betreibers' })).toBeTruthy();
    expect(screen.getByText('nur').tagName).toBe('STRONG');
    expect(screen.getByRole('button', { name: 'Einverstanden' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nein' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Impressum' })).toBeTruthy();
    expect(w.calls).not.toContain('exchange');
  });

  it('falls back to German defaults when the operator left the texts empty (v3 bug B2: no English in German)', async () => {
    mount(world(gate({ title: '', body: '', acceptLabel: '', rejectLabel: '', footerPages: [] })));
    expect(
      await screen.findByRole('heading', { name: de['participant_consent_title'] as string }),
    ).toBeTruthy();
    expect(screen.getByText(de['participant_consent_body'] as string)).toBeTruthy();
    expect(screen.getByRole('button', { name: de['participant_consent_accept'] as string })).toBeTruthy();
    expect(screen.getByRole('button', { name: de['participant_consent_reject'] as string })).toBeTruthy();
  });

  it('a legal page opens inside the modal and "Zurück" returns to the notice', async () => {
    mount(world(gate()));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Impressum' }));
    expect(screen.getByText('Betreiber: Stadt X')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: de['participant_consent_back'] as string }));
    expect(screen.getByRole('heading', { name: 'Datenschutz des Betreibers' })).toBeTruthy();
  });

  it('Reject keeps the modal open and the user out', async () => {
    const w = world(gate());
    const view = mount(w);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nein' }));
    await waitFor(() => expect(w.calls).toContain('decide:rejected'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(w.calls).not.toContain('exchange');
    expect(view.go).not.toHaveBeenCalled();
  });

  it('a guest link bounced here (?returnTo=/join/..) goes back to it after Accept (WP-639); other targets are ignored', async () => {
    const w = world(gate());
    const view = mount(w, `?returnTo=${encodeURIComponent('/join/maengel?next=%2Fapp')}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einverstanden' }));
    await waitFor(() => expect(view.leave).toHaveBeenCalledWith('/join/maengel?next=%2Fapp'));
    expect(view.go).not.toHaveBeenCalled();
    cleanup();
    const w2 = world(gate());
    const v2 = mount(w2, `?returnTo=${encodeURIComponent('//evil.example')}`);
    await user.click(await screen.findByRole('button', { name: 'Einverstanden' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(v2.go).not.toHaveBeenCalled();
    expect(v2.leave).not.toHaveBeenCalled();
  });

  it('Accept closes the modal and the token form works', async () => {
    const w = world(gate());
    const view = mount(w);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einverstanden' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.type(screen.getByTestId('token-input'), 'tok');
    await user.click(screen.getByTestId('login-button'));
    await waitFor(() => expect(view.go).toHaveBeenCalledWith('/map'));
    expect(w.calls).toEqual(['consent', 'decide:accepted', 'exchange']);
  });

  it('a ?token= link waits for the decision, then signs in without another tap', async () => {
    const w = world(gate());
    const view = mount(w, '?token=abc');
    const user = userEvent.setup();
    await screen.findByRole('dialog');
    expect(w.calls).not.toContain('exchange');
    expect(location.search).toBe('');
    await user.click(screen.getByRole('button', { name: 'Einverstanden' }));
    await waitFor(() => expect(view.go).toHaveBeenCalledWith('/map'));
    expect(w.calls).toEqual(['consent', 'decide:accepted', 'exchange']);
  });

  it('a ?token= link signs in at once when consent is off or already given', async () => {
    const w = world(gate({ required: false }));
    const view = mount(w, '?token=abc');
    await waitFor(() => expect(view.go).toHaveBeenCalledWith('/map'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a 403 consent_required from the exchange (cookie gone) opens the modal', async () => {
    const w = world(gate({ required: true }));
    w.consent = gate({ required: false });
    const view = mount(w);
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('token-input'), 'tok');
    w.consent = gate({ required: true });
    await user.click(screen.getByTestId('login-button'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(view.go).not.toHaveBeenCalled();
  });

  it('has no axe violations with the modal open', async () => {
    const view = mount(world(gate()));
    await screen.findByRole('dialog');
    const result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
