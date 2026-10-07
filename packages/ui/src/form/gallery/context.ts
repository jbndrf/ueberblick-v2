// The app hands the gallery its URL resolver once, high in the tree (the form and Daten sit in different subtrees).
import { getContext, setContext } from 'svelte';
import type { PhotoUrl } from './files';

export const PHOTO_URL_KEY = Symbol('ub-photo-url');

export function providePhotoUrl(resolve: PhotoUrl): void {
  setContext(PHOTO_URL_KEY, resolve);
}

/** `undefined` without a provider: the gallery then draws every file as a file row, never a broken image. */
export function photoUrlFromContext(): PhotoUrl | undefined {
  return getContext<PhotoUrl | undefined>(PHOTO_URL_KEY);
}
