/** The v3 design kit's Input (WP-610) as this package's typecheck sees it (see `button.d.ts`). */
import type { Component } from 'svelte';
import type { HTMLInputAttributes } from 'svelte/elements';

export declare const Input: Component<HTMLInputAttributes & { value?: string }>;
