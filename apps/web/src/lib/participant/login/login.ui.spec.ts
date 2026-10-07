// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { setMode } from 'mode-watcher';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import LoginPage from './LoginPage.svelte';
import { LOCALE_KEY } from './locale';
import type { LoadScanner, QrScanner } from './scanner';

// jsdom has no layout engine: stub what bits-ui probes at mount.
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
const en = catalogue('en');
const T = (key: string, c: Record<string, string> = de): string => c[`participant_${key}`] ?? `?${key}`;

const ok = () => Promise.resolve(new Response('{}', { status: 200 }));
const refuse =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers }));

interface FakeScanner extends QrScanner {
  emit(text: string): void;
  stops: number;
  file: string | Error;
}
function fakeScanner(): FakeScanner {
  let onDecoded: (text: string) => void = () => {};
  const s: FakeScanner = {
    stops: 0,
    file: 'from-image',
    emit: (text) => onDecoded(text),
    startCamera: (cb) => {
      onDecoded = cb;
      return Promise.resolve();
    },
    stop: () => {
      s.stops++;
      return Promise.resolve();
    },
    scanFile: () => (s.file instanceof Error ? Promise.reject(s.file) : Promise.resolve(s.file)),
  };
  return s;
}

function mount(
  options: {
    fetch?: () => Promise<Response>;
    scanner?: FakeScanner;
    locale?: 'de' | 'en';
    go?: () => Promise<void>;
  } = {},
) {
  localStorage.setItem(LOCALE_KEY, options.locale ?? 'de');
  const scanner = options.scanner ?? fakeScanner();
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(options.fetch ?? ok);
  const go = vi.fn(options.go ?? (() => Promise.resolve()));
  const leave = vi.fn();
  const load: LoadScanner = vi.fn(() => Promise.resolve(scanner));
  // The consent gate read (WP-638) is not an exchange: it answers "off" and is not counted in `fetch`.
  const gateOff = (url: string, init?: RequestInit) =>
    url === '/api/instance/consent'
      ? Promise.resolve(new Response(JSON.stringify({ required: false }), { status: 200 }))
      : fetch(url, init);
  const view = render(LoginPage, { fetch: gateOff, load, go, leave });
  return { ...view, scanner, fetch, go, leave, load };
}
const sent = (fetch: ReturnType<typeof vi.fn>): unknown[] =>
  fetch.mock.calls.map((c) => JSON.parse(String((c as [string, RequestInit])[1].body)));

beforeEach(() => history.replaceState(null, '', '/login'));
afterEach(() => {
  cleanup();
  document.body.removeAttribute('style'); // an open menu leaves its scroll lock behind in jsdom
  localStorage.clear();
});

describe('token tab', () => {
  it('typed token + one tap signs in and goes to /map', async () => {
    const { fetch, go } = mount();
    await userEvent.type(screen.getByLabelText(T('login_token_label')), 'abc123');
    await userEvent.click(screen.getByRole('button', { name: T('login_submit') }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('/map'));
    expect(sent(fetch)).toEqual([{ token: 'abc123' }]);
  });

  it('show/hide switches the field type', async () => {
    mount();
    const field = screen.getByLabelText(T('login_token_label'));
    expect(field.getAttribute('type')).toBe('password');
    await userEvent.click(screen.getByRole('button', { name: T('login_show_token') }));
    expect(field.getAttribute('type')).toBe('text');
  });
});

describe('login link', () => {
  it('?token= signs in with zero taps and clears the address', async () => {
    history.replaceState(null, '', '/login?token=link-token');
    const { fetch, go } = mount();
    await waitFor(() => expect(go).toHaveBeenCalledWith('/map'));
    expect(sent(fetch)).toEqual([{ token: 'link-token' }]);
    expect(location.pathname + location.search + location.hash).toBe('/login');
  });

  it('a refused link shows the reason and keeps the form', async () => {
    history.replaceState(null, '', '/login?token=x');
    const { go } = mount({ fetch: refuse(401, { code: 'credential_revoked' }) });
    expect((await screen.findByRole('alert')).textContent).toContain(T('login_err_invalid'));
    expect(go).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  const cases = [
    ['credential_unknown', 'login_err_invalid'],
    ['credential_revoked', 'login_err_invalid'],
    ['credential_expired', 'login_err_expired'],
    ['participant_disabled', 'login_err_inactive'],
    ['token_invalid', 'login_err_generic'],
  ] as const;
  const attempt = async (fetchImpl: () => Promise<Response>, locale: 'de' | 'en') => {
    mount({ fetch: fetchImpl, locale });
    await userEvent.type(screen.getByLabelText(T('login_token_label', locale === 'de' ? de : en)), 'x');
    await userEvent.click(screen.getByRole('button', { name: T('login_submit', locale === 'de' ? de : en) }));
    return (await screen.findByRole('alert')).textContent ?? '';
  };

  it.each(cases)('%s shows its German and English text', async (code, key) => {
    expect(await attempt(refuse(401, { code }), 'de')).toContain(T(key));
    cleanup();
    expect(await attempt(refuse(401, { code }), 'en')).toContain(T(key, en));
  });

  it('429 shows the rate-limit message with the minutes, in both languages', async () => {
    const r = refuse(429, {}, { 'retry-after': '125' });
    expect(await attempt(r, 'de')).toContain('3 Minute(n)');
    cleanup();
    expect(await attempt(r, 'en')).toContain('3 minute(s)');
  });
});

describe('QR tab', () => {
  const openQr = async () => {
    await userEvent.click(screen.getByRole('tab', { name: T('login_tab_qr') }));
    const start = await screen.findByRole('button', { name: T('login_qr_start_camera') });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    return start;
  };

  it('the scanner library is not loaded until the QR tab opens', async () => {
    const { load } = mount();
    expect(load).not.toHaveBeenCalled();
    await openQr();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a raw token', 'raw-token', 'raw-token'],
    ['a login link', `${location.origin}/login?token=link-token`, 'link-token'],
  ])('a decoded %s submits', async (_name, text, token) => {
    const { scanner, fetch } = mount();
    await userEvent.click(await openQr());
    scanner.emit(text);
    await waitFor(() => expect(sent(fetch)).toEqual([{ token }]));
  });

  it('a link of the own origin without a token shows a message and does not submit', async () => {
    const { scanner, fetch } = mount();
    await userEvent.click(await openQr());
    scanner.emit(`${location.origin}/elsewhere`);
    expect((await screen.findByRole('alert')).textContent).toContain(T('login_qr_no_token'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a link from another origin shows the invalid code message and does not submit', async () => {
    const { scanner, fetch } = mount();
    await userEvent.click(await openQr());
    scanner.emit('https://elsewhere.example/login?token=abc123');
    expect((await screen.findByRole('alert')).textContent).toContain(T('login_qr_invalid'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an uploaded image is decoded and submitted; an unreadable one shows the file error', async () => {
    const { fetch, go } = mount();
    await openQr();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['x'], 'qr.png', { type: 'image/png' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('/map'));
    expect(sent(fetch)).toEqual([{ token: 'from-image' }]);
    cleanup();

    const bad = fakeScanner();
    bad.file = new Error('no qr');
    mount({ scanner: bad });
    await openQr();
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'p.png', { type: 'image/png' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(T('login_qr_file_error'));
  });

  it('an image whose decode never finishes ends in the file error, not silence', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const scanner = fakeScanner();
      scanner.scanFile = () => new Promise<string>(() => {});
      mount({ scanner });
      await openQr();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await userEvent.upload(input, new File(['x'], 'qr.png', { type: 'image/png' }));
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await screen.findByRole('alert')).textContent).toContain(T('login_qr_file_error'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a navigation that fails after the exchange shows an error instead of hanging', async () => {
    const { scanner } = mount({ go: () => Promise.reject(new Error('nav')) });
    expect(scanner).toBeDefined();
    await openQr();
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'qr.png', { type: 'image/png' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(T('login_err_generic'));
  });

  it('leaving the QR tab stops the camera', async () => {
    const { scanner } = mount();
    await userEvent.click(await openQr());
    const before = scanner.stops;
    await userEvent.click(screen.getByRole('tab', { name: T('login_tab_token') }));
    await waitFor(() => expect(scanner.stops).toBeGreaterThan(before));
  });

  it('a camera that is refused shows the camera error', async () => {
    const scanner = fakeScanner();
    scanner.startCamera = () => Promise.reject(new Error('denied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount({ scanner });
    await userEvent.click(await openQr());
    expect((await screen.findByRole('alert')).textContent).toContain(T('login_qr_camera_error'));
  });
});

describe('language and theme', () => {
  it('the language switch changes every text and is stored on the device', async () => {
    mount();
    expect(screen.getByRole('tab', { name: de['participant_login_tab_token'] ?? '' })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: T('login_language') });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    // jsdom: the open menu sets pointer-events none on body, so click the item directly
    fireEvent.click(await screen.findByText('English', { selector: '[role="menuitemradio"]' }));
    await waitFor(() => expect(localStorage.getItem(LOCALE_KEY)).toBe('en'));
    expect(await screen.findByRole('tab', { name: T('login_tab_token', en) })).toBeTruthy();
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('the theme button offers the other mode and toggles it', async () => {
    setMode('light');
    mount();
    await userEvent.click(screen.getByRole('button', { name: T('login_theme_to_dark') }));
    expect(await screen.findByRole('button', { name: T('login_theme_to_light') })).toBeTruthy();
    setMode('light');
  });
});

describe('WP-651 gaps', () => {
  it('an empty token shows the field error under the input, sends nothing and has no native bubble', async () => {
    const { fetch } = mount();
    const field = screen.getByLabelText(T('login_token_label'));
    expect(field.hasAttribute('required')).toBe(false);
    await userEvent.type(field, '   ');
    await userEvent.click(screen.getByRole('button', { name: T('login_submit') }));
    const error = await screen.findByText(T('login_token_required'));
    expect(error.className).toContain('text-destructive');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.className).toContain('border-destructive');
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.type(field, 'x');
    expect(screen.queryByText(T('login_token_required'))).toBeNull();
  });

  it('the field error is German or English like the rest', async () => {
    mount({ locale: 'en' });
    await userEvent.click(screen.getByRole('button', { name: T('login_submit', en) }));
    expect(await screen.findByText(T('login_token_required', en))).toBeTruthy();
  });

  it('the body does not scroll while the page is open and is released on leaving', () => {
    const { unmount } = mount();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('accessibility', () => {
  it('the token tab and the QR tab have no axe violations', async () => {
    const { container } = mount();
    const run = async () =>
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
        (v) => `${v.id}: ${v.help}`,
      );
    expect(await run()).toEqual([]);
    await userEvent.click(screen.getByRole('tab', { name: T('login_tab_qr') }));
    await screen.findByRole('button', { name: T('login_qr_start_camera') });
    expect(await run()).toEqual([]);
  });
});
