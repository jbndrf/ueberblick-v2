// The photos in scope of the device: every image in a file value of a feature the device holds (v3 listed the file
// fields of the downloaded records, `pack-downloader.svelte.ts:225-240`). A pass over the features, in slices that give
// the main thread back, so it never makes a long task (R14); it runs when the switch turns on and after a sync.
import type { FeatureId, FeatureState, Json } from '@ueberblick/core/model';
import { fileRefs, isImage } from '@ueberblick/ui';

export interface ScanInput {
  readonly features: Iterable<{ readonly properties: Readonly<Record<string, Json>> }>;
  /** Features per slice. */
  readonly slice?: number;
  /** Lets the browser breathe between slices (a macrotask in the app). */
  readonly yieldNow: () => Promise<void>;
}

export const SCAN_SLICE = 500;

export async function scanPhotos(input: ScanInput): Promise<readonly string[]> {
  const slice = input.slice ?? SCAN_SLICE;
  const found = new Set<string>();
  let n = 0;
  for (const feature of input.features) {
    for (const value of Object.values(feature.properties))
      for (const file of fileRefs(value)) if (isImage(file)) found.add(file.sha256);
    if (++n % slice === 0) await input.yieldNow();
  }
  return [...found];
}

/** A macrotask turn: the browser paints and handles input first. */
export const nextTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Every feature the device holds, type by type, one at a time (the caller slices the pass with `scanPhotos`). */
export function* deviceFeatures(
  store: {
    featureIdsOfType(type: string): readonly FeatureId[];
    readonly facts: { feature(id: FeatureId): FeatureState | undefined };
  },
  types: readonly string[],
): Generator<FeatureState> {
  for (const type of types)
    for (const id of store.featureIdsOfType(type)) {
      const f = store.facts.feature(id);
      if (f !== undefined) yield f;
    }
}
