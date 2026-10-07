import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

/** The CSS variables declared by one top-level rule, e.g. `:root` or `.dark`. */
function variables(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('\n}', start));
  return new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]),
  );
}

describe('theme (v3 app.css): light and dark', () => {
  const light = variables(':root');
  const dark = variables('.dark');

  it('dark mode is class-based: `.dark` on an ancestor switches the variables', () => {
    expect(css).toContain('@custom-variant dark (&:is(.dark *));');
    expect(light.get('color-scheme')).toBeUndefined();
    expect(css).toMatch(/:root \{\s*color-scheme: light;/);
    expect(css).toMatch(/\.dark \{\s*color-scheme: dark;/);
  });

  it('every colour variable the kit reads is defined in both themes, with different values', () => {
    for (const name of [
      '--background',
      '--foreground',
      '--primary',
      '--card',
      '--popover',
      '--border',
      '--input',
      '--ring',
    ]) {
      expect(light.has(name), `light ${name}`).toBe(true);
      expect(dark.has(name), `dark ${name}`).toBe(true);
      expect(dark.get(name), name).not.toBe(light.get(name));
    }
  });

  it('exposes the variables as Tailwind colours (the only colour source: theme seam for admin theming)', () => {
    expect(css).toContain('--color-background: var(--background);');
    expect(css).toContain('--color-primary: var(--primary);');
  });
});
