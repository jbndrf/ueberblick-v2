import type { Principal } from '@ueberblick/server';

declare global {
  /** The installed maplibre-gl version, defined by `vite.config.ts`; it names the worker folder in the build. */
  const __MAPLIBRE_VERSION__: string;

  namespace App {
    interface Locals {
      /**
       * The two sessions of a browser, resolved independently (WP-705; v3 `hooks.server.ts` `locals.admin` /
       * `locals.participant`): each is null when that cookie is absent, unknown, expired or holds the other kind.
       * Set by `hooks.server.ts`.
       */
      admin: Principal | null;
      participant: Principal | null;
    }
  }
}

export {};
