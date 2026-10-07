/**
 * The one breakpoint of the participant UI (the viewport is narrower than 768 px; 768 px and wider is desktop, as the kit, the map and Tailwind's `md:`). Every component
 * that switches between the phone and the desktop layout reads it here; none adds its own `innerWidth` listener.
 */
import { createSubscriber } from 'svelte/reactivity';

/** Viewports narrower than this are a phone. v3 had two edges (module-shell `<= 768`, kit/map/Tailwind `< 768`); this is the one. */
export const MOBILE_BELOW_PX = 768;

export const isMobileWidth = (width: number): boolean => width < MOBILE_BELOW_PX;

// One resize listener for all readers: created with the first reader, removed with the last.
const subscribe = createSubscriber((update) => {
  window.addEventListener('resize', update);
  return () => window.removeEventListener('resize', update);
});

/**
 * True on a phone. Reactive: read it inside `$derived`, `$effect` or a template and it follows the window.
 * Without a window (server render) it says phone, as v3 does ("mobile first, so there is no flash on open").
 */
export function isMobile(): boolean {
  if (typeof window === 'undefined') return true;
  subscribe();
  return isMobileWidth(window.innerWidth);
}
