import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const staticDir = new URL('../../static/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', staticDir), 'utf8')) as Record<
  string,
  unknown
>;

describe('manifest.webmanifest', () => {
  it('names the app and starts at the map, standalone and portrait', () => {
    expect(manifest).toMatchObject({
      name: 'Überblick',
      start_url: '/map',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait-primary',
    });
  });

  it('has any and maskable icons at 192 and 512 that exist', () => {
    const icons = manifest['icons'] as Array<{ src: string; sizes: string; purpose: string }>;
    const have = icons.map((i) => `${i.sizes}/${i.purpose}`).sort();
    expect(have).toEqual(['192x192/any', '192x192/maskable', '512x512/any', '512x512/maskable']);
    for (const i of icons) expect(existsSync(new URL(i.src.slice(1), staticDir))).toBe(true);
  });

  it('is linked from app.html', () => {
    expect(readFileSync(new URL('../app.html', import.meta.url), 'utf8')).toContain(
      'rel="manifest" href="/manifest.webmanifest"',
    );
  });
});
