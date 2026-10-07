import { createRawSnippet } from 'svelte';

/** A children snippet that renders plain text, for tests. */
export function text(s: string) {
  return createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));
}
