// @vitest-environment jsdom
// WP-679: the Vorschau banner of a preview login (owner answer V3 (a)); wording from the lead, WP-373 keeps the data.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import axe from 'axe-core';
import PreviewBanner from './PreviewBanner.svelte';
import { message } from './messages';

afterEach(cleanup);

describe('the Vorschau banner', () => {
  it('says the lead wording in de and en', () => {
    expect(message('de', 'preview_banner')).toBe('Vorschau – Testdaten, nicht die echten Daten');
    expect(message('en', 'preview_banner')).toBe('Preview – test data, not the real data');
  });

  it.each([
    ['de', 390],
    ['en', 390],
    ['de', 1280],
    ['en', 1280],
  ] as const)(
    'shows the text in %s at %i px, is not dismissable and has no axe violations',
    async (locale, w) => {
      window.innerWidth = w;
      const { container } = render(PreviewBanner, { locale });
      const banner = screen.getByTestId('preview-banner');
      expect(banner.textContent).toContain(message(locale, 'preview_banner'));
      expect(container.querySelectorAll('button, a')).toHaveLength(0);
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    },
  );
});
