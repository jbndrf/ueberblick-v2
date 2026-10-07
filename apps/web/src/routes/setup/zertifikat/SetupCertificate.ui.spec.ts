// @vitest-environment jsdom
// WP-941: /setup/zertifikat renders in German and English, every string from the catalogue.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import SetupCertificate from './SetupCertificate.svelte';
import { STEP_KEYS } from './steps';

afterEach(cleanup);
const SVG = '<svg viewBox="0 0 1 1"></svg>';
const props = {
  ca: { fingerprint: 'AA:BB' },
  qr: SVG,
  pageUrl: 'https://192.168.1.20:8443/setup/zertifikat',
};
const catalogue = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../../messages', `${lang}.json`), 'utf8'));

describe('the setup page', () => {
  it('says why, in German, and offers both downloads', () => {
    render(SetupCertificate, { locale: 'de', ...props });
    expect(
      screen.getByText(
        'Damit Kamera und Offline-Betrieb funktionieren, muss Ihr Gerät diesem Server einmal vertrauen.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /\.crt/ }).getAttribute('href')).toBe('/setup/zertifikat/ca.crt');
    expect(screen.getByRole('link', { name: /\.mobileconfig/ }).getAttribute('href')).toBe(
      '/setup/zertifikat/ueberblick.mobileconfig',
    );
    expect(document.title).toBe('Zertifikat vertrauen - Überblick');
  });

  it('is in English with the same structure', () => {
    render(SetupCertificate, { locale: 'en', ...props });
    expect(
      screen.getByText('For the camera and offline use to work, your device must trust this server once.'),
    ).toBeTruthy();
    expect(document.title).toBe('Trust the certificate - Überblick');
  });

  it('has numbered steps for Android, iOS, Windows and macOS', () => {
    const { container } = render(SetupCertificate, { locale: 'en', ...props });
    expect(container.querySelectorAll('ol')).toHaveLength(4);
    for (const name of ['Android', 'iOS (iPhone, iPad)', 'Windows', 'macOS'])
      expect(screen.getByRole('heading', { name })).toBeTruthy();
  });

  it('shows the QR code of the page and its address', () => {
    const { container } = render(SetupCertificate, { locale: 'de', ...props });
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText(props.pageUrl)).toBeTruthy();
    expect(screen.getByText(/AA:BB/)).toBeTruthy();
  });

  it('shows only a note and no downloads when the server has no CA', () => {
    render(SetupCertificate, { locale: 'en', ...props, ca: null });
    expect(screen.getByText(/does not use its own certificate/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('the catalogue', () => {
  it('has every key of the page in German and English', () => {
    const own = [
      'title',
      'why',
      'warning',
      'download_heading',
      'download_crt',
      'download_ios',
      'fingerprint',
      'steps_heading',
      'qr_heading',
      'qr_label',
      'not_direct',
    ].map((k) => `setup_cert_${k}`);
    const keys = [...own, ...STEP_KEYS.flatMap((s) => [s.heading, ...s.steps])];
    for (const lang of ['de', 'en']) {
      const c = catalogue(lang);
      for (const k of keys) expect(c[`participant_${k}`], `${lang} ${k}`).toBeTruthy();
      const used = new Set(keys.map((k) => `participant_${k}`));
      const extra = Object.keys(c).filter((k) => k.startsWith('participant_setup_cert_') && !used.has(k));
      expect(extra, `${lang}: keys the page does not use`).toEqual([]);
    }
  });
});
