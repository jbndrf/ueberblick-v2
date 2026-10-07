/** Where the instance says it lives when `PUBLIC_URL` is unset: still a contact for the tile host. */
const FALLBACK_ORIGIN = 'https://github.com/ueberblick';

/**
 * The User-Agent of every request this server sends to a tile host, the tile proxy and the pack builder alike (A-033).
 * Tile providers' usage policies (OSM) ask for an identifying agent with a contact; the public URL is that contact.
 */
export const tileUserAgent = (origin: string | undefined): string =>
  `Überblick/4 (+${origin ?? FALLBACK_ORIGIN})`;
