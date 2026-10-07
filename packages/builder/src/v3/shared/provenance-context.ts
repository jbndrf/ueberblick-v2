/**
 * What a card hands its "⋯" menu about the element's provenance, so the menu entries (Auf Vorlage zurücksetzen,
 * Ausblenden) sit with the element without every layer in between passing it on. Getters: the document changes.
 */
import { getContext, setContext } from 'svelte';
import type { ProvenanceInfo } from './provenance';

export interface ElementProvenance {
  /** Undefined in a project without a template: no marks, no entries. */
  info(): ProvenanceInfo | undefined;
  /** Puts the element back to the template. */
  reset(): void;
}

const KEY = Symbol.for('ueberblick.builder.element-provenance');

export const provideProvenance = (p: ElementProvenance): ElementProvenance => setContext(KEY, p);

export const useProvenance = (): ElementProvenance | undefined =>
  getContext<ElementProvenance | undefined>(KEY);
