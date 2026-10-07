// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import NoDraft from './NoDraft.svelte';

describe('no-draft page title (WCAG 2.4.2)', () => {
  it('names state, project and product in en', () => {
    render(NoDraft, { project: 'musterstadt', locale: 'en' });
    expect(document.title).toBe('No project file - musterstadt - Überblick Builder');
  });

  it('is localised in de', () => {
    render(NoDraft, { project: 'musterstadt', locale: 'de' });
    expect(document.title).toBe('Keine Projektdatei - musterstadt - Überblick Builder');
  });
});
