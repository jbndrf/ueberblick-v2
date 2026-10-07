import { getContext, setContext } from 'svelte';

const KEY = Symbol('kit-inside-modal');

/** Set by the kit dialog content: popovers below it render in place, since bits-ui's modal makes the body inert (WP-663). */
export function provideInsideModal(): void {
  setContext(KEY, true);
}

/** True inside a kit dialog's content. Read once at component init. */
export function isInsideModal(): boolean {
  return getContext<boolean | undefined>(KEY) === true;
}
