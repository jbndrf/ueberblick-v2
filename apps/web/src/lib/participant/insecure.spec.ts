// @vitest-environment jsdom
// WP-595: a page served over plain http gets an explanation, not "could not be loaded".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { InsecureContextError } from '@ueberblick/client';
import InsecureNotice from './InsecureNotice.svelte';
import { httpsAddress, startupNotice } from './insecure';
import { message } from './messages';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

describe('insecure context notice', () => {
  it('maps the typed error to the https notice and every other startup error to load_failed', () => {
    expect(startupNotice(new InsecureContextError())).toBe('insecure_context');
    expect(startupNotice(new Error('x'))).toBe('load_failed');
    expect(startupNotice('x')).toBe('load_failed');
  });

  it('builds the https address hint from the current location', () => {
    expect(httpsAddress({ host: '192.168.0.7:8080', pathname: '/app', search: '?x=1' })).toBe(
      'https://192.168.0.7:8080/app?x=1',
    );
  });

  it.each(['de', 'en'] as const)('shows the explanation and the address in %s', (locale) => {
    render(InsecureNotice, { locale, address: 'https://demo.example/app' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(message(locale, 'insecure_context'));
    expect(alert.textContent).toContain(
      message(locale, 'insecure_address', { address: 'https://demo.example/app' }),
    );
    expect(alert.textContent).toContain('https://demo.example/app');
    expect(alert.textContent).not.toContain(message(locale, 'load_failed'));
  });

  it('says https in both languages, in different words', () => {
    expect(message('de', 'insecure_context')).toMatch(/https/);
    expect(message('en', 'insecure_context')).toMatch(/https/);
    expect(message('de', 'insecure_context')).not.toBe(message('en', 'insecure_context'));
  });

  it.each(['server-install.md', 'server-install.en.md'])(
    'the admin docs (%s) say https is required, and why',
    (file) => {
      const doc = readFileSync(join(REPO, 'docs/user/admin', file), 'utf8');
      expect(doc).toMatch(/HTTPS ist .* Pflicht|HTTPS is required/);
      expect(doc).toMatch(/Web Locks/);
    },
  );
});
