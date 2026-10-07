// WP-716: the app theme's focus ring (the photo buttons draw themselves: packages/tools/photo) (jsdom does no layout; the a11y e2e measures the ring).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

describe('app.css', () => {
  it('draws one solid 2px focus ring in the foreground colour, unlayered so it beats the kit ring-ring/50', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--foreground\)/);
    expect(css).not.toMatch(/@layer[^{]*\{[^]*:focus-visible/);
  });
});
