import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Builds apps/web's stylesheet with the same Tailwind plugin as vite.config.ts and returns the emitted CSS. */
async function buildCss(): Promise<string> {
  const out = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [tailwindcss()],
    build: { write: false, rollupOptions: { input: `${root}src/app.css` } },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []));
  return outputs.map((o) => (o.type === 'asset' ? String(o.source) : '')).join('\n');
}

describe('design system in the app build (B-015)', () => {
  it('generates Tailwind classes that only a packages/ui component uses', async () => {
    const css = await buildCss();
    // `rounded-xl` and `bg-primary/20` appear in packages/ui/src/components/ui (card, progress) and nowhere in apps/web
    expect(css).toContain('.rounded-xl');
    expect(css).toContain('bg-primary\\/20');
    expect(css).toContain('animate-pulse');
  }, 60_000);

  it('ships v3 theme variables and the dark class variant', async () => {
    const css = await buildCss();
    expect(css).toContain('--background:');
    expect(css).toMatch(/\.dark\s*\{/);
  }, 60_000);

  it('the root layout imports the stylesheet once and mounts the theme bootstrap', () => {
    const layout = readFileSync(`${root}src/routes/+layout.svelte`, 'utf8');
    expect(layout).toContain("import '../app.css'");
    expect(layout).toContain('<ModeWatcher');
    const html = readFileSync(`${root}src/app.html`, 'utf8');
    expect(html).toContain('nonce="%sveltekit.nonce%"');
    expect(html).toContain("classList.toggle('dark'");
  });
});
