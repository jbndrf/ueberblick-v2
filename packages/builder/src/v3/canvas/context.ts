/** The canvas' editing state, shared with the node components below the flow (they only say what was done to them). */
import { getContext, setContext } from 'svelte';
import type { CanvasState } from './state.svelte';

const KEY = Symbol.for('ueberblick.builder.canvas');

export const setCanvasState = (state: CanvasState): CanvasState => setContext(KEY, state);

export function getCanvasState(): CanvasState {
  const state = getContext<CanvasState | undefined>(KEY);
  if (state === undefined) throw new Error('getCanvasState() outside the canvas');
  return state;
}
