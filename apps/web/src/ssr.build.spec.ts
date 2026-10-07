import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import config, { SVELTE_SHIPPING_DEPS } from '../vite.config';

const root = fileURLToPath(new URL('..', import.meta.url));
const checkbox = fileURLToPath(
  new URL('../../../packages/ui/src/components/ui/checkbox/checkbox.svelte', import.meta.url),
);

describe('SSR build of kit dependencies that ship .svelte files (WP-633)', () => {
  it('lists the kit dependencies that ship .svelte files as ssr.noExternal', () => {
    expect(config).toMatchObject({ ssr: { noExternal: SVELTE_SHIPPING_DEPS } });
    expect(SVELTE_SHIPPING_DEPS).toEqual(
      expect.arrayContaining(['@lucide/svelte', 'bits-ui', 'svelte-sonner']),
    );
  });

  it('loads the kit checkbox (which imports @lucide/svelte icons) on the server', async () => {
    const server = await createServer({ root, logLevel: 'silent', server: { middlewareMode: true } });
    try {
      const mod = await server.ssrLoadModule(`/@fs${checkbox}`);
      expect(typeof mod.default).toBe('function');
    } finally {
      await server.close();
    }
  }, 60_000);
});
