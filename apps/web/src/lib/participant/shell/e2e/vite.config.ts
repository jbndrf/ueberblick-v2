import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { harnessCacheDir } from '../../../../../../../scripts/e2e/component-config.mjs';

/** The harness page for the map shell e2e: a plain Vite page with the real slot and the real kit CSS. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: harnessCacheDir(import.meta.url),
  plugins: [tailwindcss(), svelte()],
  server: { fs: { allow: [fileURLToPath(new URL('../../../../../../..', import.meta.url))] } },
});
