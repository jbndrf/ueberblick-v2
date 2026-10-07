import { createRequire } from 'node:module';

// The installed MapLibre version, and the Vite `define` that hands it to `shell/MapCanvas.svelte` (`__MAPLIBRE_VERSION__`).
// The app build (`vite.config.ts`) and the spec run (root `vitest.config.ts`) both import it, so the constant is
// defined once.
const require = createRequire(import.meta.url);

export const MAPLIBRE_VERSION = (require('maplibre-gl/package.json') as { version: string }).version;

export const maplibreDefine = { __MAPLIBRE_VERSION__: JSON.stringify(MAPLIBRE_VERSION) } as const;
