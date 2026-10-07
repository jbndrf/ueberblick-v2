/**
 * The one Content-Security-Policy. Plain JS so `svelte.config.js` (`kit.csp`, nonce mode for pages) and
 * `security-headers.ts` (every other response) read the same object. Scripts never need `'unsafe-inline'`:
 * SvelteKit's start script carries a per-response nonce, and tool plug-ins ship no inline scripts (docs/09).
 */
export const CSP_DIRECTIVES = {
  'default-src': ['self'],
  'script-src': ['self'],
  'style-src': ['self', 'unsafe-inline'],
  'img-src': ['self', 'data:', 'blob:'],
  'connect-src': ['self'],
  'worker-src': ['self', 'blob:'],
  'object-src': ['none'],
  'base-uri': ['self'],
  'form-action': ['self'],
  'frame-ancestors': ['none'],
};

const KEYWORDS = new Set(['self', 'none', 'unsafe-inline']);

/**
 * The directives that also carry the map origins of the deployed and preview configs (`mapOrigins` of core, kept by
 * `map-origins.ts`): tiles and WMS images are fetched by MapLibre's worker (`connect-src`), `img-src` serves plain
 * `<img>` previews. The static list above never names a map host: the origins come from the project files.
 */
export const MAP_DIRECTIVES = ['connect-src', 'img-src'];

/** Serialises the directives into a header value (for responses SvelteKit does not render). */
export function cspHeader(mapOrigins = []) {
  return Object.entries(CSP_DIRECTIVES)
    .map(([name, sources]) => {
      const all = MAP_DIRECTIVES.includes(name) ? [...sources, ...mapOrigins] : sources;
      return `${name} ${all.map((s) => (KEYWORDS.has(s) ? `'${s}'` : s)).join(' ')}`;
    })
    .join('; ');
}
