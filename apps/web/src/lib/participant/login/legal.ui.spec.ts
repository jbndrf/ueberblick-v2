// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import LegalArticle from './LegalArticle.svelte';
import LegalIndex from './LegalIndex.svelte';
import { LOCALE_KEY } from './locale';

const catalogue = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../messages', `${locale}.json`),
      'utf8',
    ),
  ) as Record<string, string>;
const de = catalogue('de');
const en = catalogue('en');

const pages = [
  { slug: 'impressum', title: 'Impressum' },
  { slug: 'datenschutz', title: 'Datenschutz' },
];

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('/legal index (v3 legal/+page.svelte)', () => {
  it('lists the pages as links to /legal/<slug> under the German title, with "Zurück" to the start', () => {
    render(LegalIndex, { pages, locale: 'de' });
    expect(
      screen.getByRole('heading', { level: 1, name: de['participant_legal_title'] as string }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Impressum' }).getAttribute('href')).toBe('/legal/impressum');
    expect(screen.getByRole('link', { name: 'Datenschutz' }).getAttribute('href')).toBe('/legal/datenschutz');
    expect(
      screen.getByRole('link', { name: de['participant_legal_back'] as string }).getAttribute('href'),
    ).toBe('/');
  });

  it('is English for an English server locale, and the device choice wins after mount', async () => {
    render(LegalIndex, { pages, locale: 'en' });
    expect(
      screen.getByRole('heading', { level: 1, name: en['participant_legal_title'] as string }),
    ).toBeTruthy();
    cleanup();
    localStorage.setItem(LOCALE_KEY, 'de');
    render(LegalIndex, { pages, locale: 'en' });
    expect(
      await screen.findByRole('heading', { level: 1, name: de['participant_legal_title'] as string }),
    ).toBeTruthy();
  });

  it('says so when no page is published', () => {
    render(LegalIndex, { pages: [], locale: 'de' });
    expect(screen.getByText(de['participant_legal_empty'] as string)).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const view = render(LegalIndex, { pages, locale: 'de' });
    expect(
      (await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
        (v) => v.id,
      ),
    ).toEqual([]);
  });
});

describe('/legal/<slug> (v3 legal/[slug]/+page.svelte)', () => {
  const page = {
    slug: 'impressum',
    title: 'Impressum',
    body: '<h2>Betreiber</h2><p>Stadt <script>x()</script>X</p>',
  };

  it('shows the sanitised body, never a script', () => {
    const view = render(LegalArticle, { page, locale: 'de' });
    expect(screen.getByRole('heading', { level: 2, name: 'Betreiber' })).toBeTruthy();
    expect(view.container.querySelector('script')).toBeNull();
    expect(
      screen.getByRole('link', { name: de['participant_legal_back'] as string }).getAttribute('href'),
    ).toBe('/');
  });

  it('has no axe violations', async () => {
    const view = render(LegalArticle, { page, locale: 'en' });
    expect(
      (await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
        (v) => v.id,
      ),
    ).toEqual([]);
  });
});
