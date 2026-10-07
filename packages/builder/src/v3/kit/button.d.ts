/**
 * The v3 design kit's Button (WP-610) as this package's typecheck sees it: `svelte-check` of this
 * package does not follow `.svelte` imports into another package's `index.ts` (the kit's own
 * typecheck does), so `tsconfig.json` maps the import here. The runtime import is the kit itself.
 */
import type { Component } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';

export declare const Button: Component<
  HTMLButtonAttributes & {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg';
  }
>;
