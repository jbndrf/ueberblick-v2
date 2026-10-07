// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import LoginCard from './LoginCard.svelte';

afterEach(cleanup);
const ok = { ok: true } as const;
const qr = async (): Promise<string> => '<svg></svg>';

async function fill(user: ReturnType<typeof userEvent.setup>, totp = '123456'): Promise<void> {
  await user.type(screen.getByLabelText('E-Mail'), 'admin@example.org');
  await user.type(screen.getByLabelText('Passwort'), 'secret-secret');
  await user.type(screen.getByLabelText('Einmalcode'), totp);
}

describe('the admin sign-in card (v3: card, logo, title, e-mail, password with eye, error banner)', () => {
  it('shows title, subtitle, the three fields and the "30 Tage" box (WP-942)', () => {
    render(LoginCard, {
      locale: 'de',
      totp: true,
      rememberDays: 30,
      submit: async () => ok,
      onsignedin: () => undefined,
      qr,
    });
    expect(screen.getByRole('heading', { name: 'Anmelden' })).toBeTruthy();
    expect(screen.getByText(/Admin-Oberfläche/)).toBeTruthy();
    expect(screen.getByLabelText('E-Mail')).toBeTruthy();
    expect(screen.getByLabelText('Passwort')).toBeTruthy();
    expect(screen.getByLabelText('Einmalcode')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: '30 Tage angemeldet bleiben' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('the eye shows and hides the password', async () => {
    render(LoginCard, {
      locale: 'de',
      totp: true,
      rememberDays: 30,
      submit: async () => ok,
      onsignedin: () => undefined,
      qr,
    });
    const user = userEvent.setup();
    const field = screen.getByLabelText('Passwort') as HTMLInputElement;
    expect(field.type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Passwort anzeigen' }));
    expect(field.type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Passwort verbergen' }));
    expect(field.type).toBe('password');
  });

  it('submits e-mail, password and code, then reports success', async () => {
    const submit = vi.fn(async () => ok);
    const onsignedin = vi.fn();
    render(LoginCard, { locale: 'de', totp: true, rememberDays: 30, submit, onsignedin, qr });
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(onsignedin).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({
      email: 'admin@example.org',
      password: 'secret-secret',
      totp: '123456',
      remember: false,
    });
  });

  it('without ADMIN_TOTP there is no code field and the code is sent blank; "30 Tage" is sent as remember', async () => {
    const submit = vi.fn(async () => ok);
    render(LoginCard, {
      locale: 'de',
      totp: false,
      rememberDays: 30,
      submit,
      onsignedin: () => undefined,
      qr,
    });
    expect(screen.queryByLabelText('Einmalcode')).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-Mail'), 'admin@example.org');
    await user.type(screen.getByLabelText('Passwort'), 'secret-secret');
    await user.click(screen.getByLabelText('30 Tage angemeldet bleiben'));
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({
      email: 'admin@example.org',
      password: 'secret-secret',
      totp: '',
      remember: true,
    });
  });

  it('an account without a confirmed code is shown its QR code and the key once', async () => {
    const otpauthUri = 'otpauth://totp/Ueberblick:a@b.c?secret=JBSWY3DPEHPK3PXP';
    render(LoginCard, {
      locale: 'de',
      totp: true,
      rememberDays: 30,
      submit: async () => ({ ok: false, problem: 'login_not_enrolled', otpauthUri }),
      onsignedin: () => undefined,
      qr,
    });
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Richten Sie den Einmalcode ein');
    expect(screen.getByRole('img', { name: 'QR-Code für die Authenticator-App' })).toBeTruthy();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeTruthy();
  });

  it.each([
    ['login_invalid', 'Die Anmeldung war nicht erfolgreich'],
    ['login_throttled', 'Zu viele Anmeldeversuche'],
    ['login_offline', 'Keine Verbindung'],
  ] as const)('shows %s in the error banner and clears the code', async (problem, text) => {
    render(LoginCard, {
      locale: 'de',
      totp: true,
      rememberDays: 30,
      submit: async () => ({ ok: false, problem }),
      onsignedin: () => undefined,
      qr,
    });
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect((screen.getByLabelText('Einmalcode') as HTMLInputElement).value).toBe('');
  });

  it('an empty form shows v3 inline errors with the red border and does not submit', async () => {
    const submit = vi.fn(async () => ok);
    render(LoginCard, {
      locale: 'de',
      totp: false,
      rememberDays: 30,
      submit,
      onsignedin: () => undefined,
      qr,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(screen.getByText('Ungültige E-Mail-Adresse')).toBeTruthy();
    expect(screen.getByText('Das Passwort muss mindestens 6 Zeichen lang sein')).toBeTruthy();
    expect(screen.getByLabelText('E-Mail').className).toContain('border-destructive');
    expect(screen.getByLabelText('Passwort').className).toContain('border-destructive');
    expect(submit).not.toHaveBeenCalled();
  });

  it('an invalid e-mail alone is flagged, and the error clears once the field is corrected', async () => {
    const submit = vi.fn(async () => ok);
    render(LoginCard, {
      locale: 'de',
      totp: false,
      rememberDays: 30,
      submit,
      onsignedin: () => undefined,
      qr,
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-Mail'), 'nicht-gueltig');
    await user.type(screen.getByLabelText('Passwort'), 'secret-secret');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(screen.getByText('Ungültige E-Mail-Adresse')).toBeTruthy();
    expect(screen.queryByText(/mindestens 6/)).toBeNull();
    await user.type(screen.getByLabelText('E-Mail'), '@example.org');
    expect(screen.queryByText('Ungültige E-Mail-Adresse')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
  });

  it('is English for en', () => {
    render(LoginCard, {
      locale: 'en',
      totp: true,
      rememberDays: 30,
      submit: async () => ok,
      onsignedin: () => undefined,
      qr,
    });
    expect(screen.getByLabelText('One-time code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});
