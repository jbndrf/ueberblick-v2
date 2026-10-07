import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { CSP_DIRECTIVES } from './src/lib/server/security/csp-directives.js';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: 'build' }),
    csp: { mode: 'nonce', directives: CSP_DIRECTIVES },
  },
};
