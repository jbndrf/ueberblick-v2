/**
 * `types.<t>.values_at_start` (A-040): every entry is an option of the type's classifying property, and the type has
 * one. The property is the one the participant filter groups by (`classifyingProperty`, never re-derived, R1).
 */
import { classifyingProperty } from '../../marker';
import type { TemplateFile } from '../file';
import { kp } from './kp';
import type { Sink } from './problems';

export function checkStart(file: TemplateFile, sink: Sink): void {
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const values = type.values_at_start;
    if (values === undefined) continue;
    const key = classifyingProperty(type);
    const options = key === undefined ? undefined : type.properties[key]?.options;
    if (key === undefined || options === undefined) {
      sink.error(
        kp('types', tk, 'values_at_start'),
        'start_values_without_property',
        {
          en: `${tk} has values_at_start, but no classifying property or stage with options`,
          de: `${tk} hat values_at_start, aber keine Klassifizierungs-Eigenschaft oder Phase mit Optionen`,
        },
        `declare process.property or classify.property on ${tk}, or remove values_at_start`,
        { type: tk },
      );
      continue;
    }
    const known = Object.keys(options);
    values.forEach((value, i) => {
      if (known.includes(value)) return;
      sink.error(
        kp('types', tk, 'values_at_start', String(i)),
        'start_value_unknown',
        {
          en: `'${value}' is not an option of ${tk}.${key}`,
          de: `'${value}' ist keine Option von ${tk}.${key}`,
        },
        `use one of: ${known.join(', ')}`,
        { value, type: tk, property: key, existing: known.join(', ') },
      );
    });
  }
}
