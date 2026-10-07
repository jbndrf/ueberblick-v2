/**
 * Where the builder gets the project file it edits (A-011): the project's working draft, kept in its
 * database by the `DraftStore`. This is the one place the routes reach the store and the template
 * source; the handlers get these functions as dependencies.
 */
import {
  createDraftStore,
  draftSources,
  ensureDraft,
  type EnsureResult,
  type PutResult,
} from '@ueberblick/server';
import { runtime } from '$lib/server/runtime';

/** The template source and the overlay source the builder opens. */
export interface DraftSources {
  readonly templateSrc: string;
  readonly overlaySrc: string;
}

/** A draft as the builder opens it, with the revision a save must name. */
export interface DraftView extends DraftSources {
  readonly revision: number;
}

/** The draft as it is now, without creating it (the problems route); null when there is none. */
export function loadDraft(project: string): DraftSources | null {
  const rt = runtime();
  const draft = createDraftStore(rt.projectDb(project)).get();
  return (draft && draftSources(draft, rt.templates)) ?? null;
}

/** The draft, created from the deployed version on first use; null when nothing is deployed. */
export function openDraft(project: string, by: string): DraftView | null {
  const rt = runtime();
  const r = ensureDraft(rt.projectDb(project), rt.clock, by);
  if (!r.ok) return null;
  const sources = draftSources(r.draft, rt.templates);
  return sources ? { ...sources, revision: r.draft.revision } : null;
}

export function ensure(project: string, by: string): EnsureResult {
  const rt = runtime();
  return ensureDraft(rt.projectDb(project), rt.clock, by);
}

export function put(project: string, expected: number, overlay: string, by: string): PutResult {
  const rt = runtime();
  return createDraftStore(rt.projectDb(project)).putIf(expected, overlay, by, rt.clock.now());
}
