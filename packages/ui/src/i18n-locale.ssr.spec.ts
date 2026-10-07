// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Probe from './testing/i18n-probe.testing.svelte';
import { setUiLocale } from './i18n-locale';

afterEach(() => setUiLocale(undefined));

describe('setUiLocale on the server (WP-394)', () => {
  it('interleaved requests each render their own language', async () => {
    // Each request sets its language and renders in the same synchronous pass (what the admin layout does).
    const pass = (lang: 'de' | 'en') => {
      setUiLocale(lang);
      return render(Probe).body;
    };
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => pass('de')),
      Promise.resolve().then(() => pass('en')),
    ]);
    expect(a).toContain('Auswählen');
    expect(b).toContain('Choose');
  });
});
