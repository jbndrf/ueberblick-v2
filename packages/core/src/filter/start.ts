/**
 * What a participant sees on the map when first opening it (A-040, v3 "Sichtbare Workflows"): the project's
 * `types.<t>.on_at_start` and `values_at_start` as the participant filter's start state. The shape is the filter
 * state's own (what is switched OFF, so a new type or value is visible by default), so the filter controller takes
 * it as is. The one reader (seam, R13): a per-role overlay (H3) is added here, nowhere else.
 */
import { classifyingProperty } from '../marker';
import type { Key } from '../model';
import type { TemplateFile } from '../schema/file';

export interface StartFilter {
  readonly hiddenTypes: ReadonlySet<Key>;
  /** Hidden values per type, of the type's classifying property. */
  readonly hiddenValues: ReadonlyMap<Key, ReadonlySet<string>>;
}

export function startFilter(file: Pick<TemplateFile, 'types'>): StartFilter {
  const hiddenTypes = new Set<Key>();
  const hiddenValues = new Map<Key, ReadonlySet<string>>();
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const key = classifyingProperty(type);
    const options = Object.keys((key === undefined ? undefined : type.properties[key]?.options) ?? {});
    if (type.on_at_start === false) {
      // As the filter's master switch off: the type and every one of its values.
      hiddenTypes.add(tk as Key);
      if (options.length > 0) hiddenValues.set(tk as Key, new Set(options));
      continue;
    }
    if (type.values_at_start === undefined) continue;
    const shown = new Set(type.values_at_start);
    const hidden = options.filter((o) => !shown.has(o));
    if (hidden.length === 0) continue;
    hiddenValues.set(tk as Key, new Set(hidden));
    // As the filter: the last value switched off hides the type.
    if (hidden.length === options.length) hiddenTypes.add(tk as Key);
  }
  return { hiddenTypes, hiddenValues };
}
