import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { harnessCacheDir } from '../../../../../scripts/e2e/component-config.mjs';

/** The harness page for the file tool e2e: a plain Vite page mounting the real tool. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: harnessCacheDir(import.meta.url),
  server: { fs: { allow: [fileURLToPath(new URL('../../../../..', import.meta.url))] } },
});
