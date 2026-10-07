import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { harnessCacheDir } from '../../../../../../../scripts/e2e/component-config.mjs';

/** The harness page for the Infoseiten e2e (a plain Vite page: the real tab, the real v3 kit CSS). */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: harnessCacheDir(import.meta.url),
  plugins: [tailwindcss(), svelte()],
  optimizeDeps: { include: ['qrcode-generator'] },
  server: { fs: { allow: [fileURLToPath(new URL('../../../../../../..', import.meta.url))] } },
});
