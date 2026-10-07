import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { harnessCacheDir } from '../../../../../../../scripts/e2e/component-config.mjs';

/** The harness page for the multi-select e2e (a plain Vite page: the real component, the real v3 kit CSS). */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: harnessCacheDir(import.meta.url),
  plugins: [tailwindcss(), svelte()],
  server: { fs: { allow: [fileURLToPath(new URL('../../../../../../..', import.meta.url))] } },
});
