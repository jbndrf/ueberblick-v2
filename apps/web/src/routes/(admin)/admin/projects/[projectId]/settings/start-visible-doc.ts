/**
 * Erststart "Sichtbare Objektarten" on the project's document (WP-397, A-040; v3 "Sichtbare Workflows",
 * `StartupSection.svelte:73-210`): `types.<t>.on_at_start` (false: off at start) and `types.<t>.values_at_start` (the
 * values of the type's classifying property that are on). The property is `classifyingProperty`, the one the
 * participant's filter groups by (R1). Headless: it takes a `Doc` and returns the next one.
 */
import { classifyingProperty, localize, type FeatureType, type TemplateFile } from '@ueberblick/core';
import type { Doc } from '@ueberblick/builder';
import type { StartType, StartTypeValue, StartTypes } from '../../../../../../lib/admin/settings/start-types';
import { clearPath, type SettingsEdit } from './settings-doc';

/** The options of the type's classifying property, in declaration order; none when it has no such property. */
function optionsOf(type: FeatureType, locale: string): { key: string; label: string }[] {
  const property = classifyingProperty(type);
  const options = property === undefined ? undefined : type.properties[property]?.options;
  return Object.entries(options ?? {}).map(([key, label]) => ({
    key,
    label: localize(label, [locale]) || key,
  }));
}

/** The Objektarten that have a place on the map, with their values and what is on at start. */
export function startTypesView(file: TemplateFile, locale: string): readonly StartType[] {
  return Object.entries(file.types ?? {}).flatMap(([key, type]) => {
    if (type.geometry === undefined) return [];
    const shown = type.values_at_start === undefined ? undefined : new Set(type.values_at_start);
    const values: StartTypeValue[] = optionsOf(type, locale).map(({ key: value, label }) => ({
      value,
      label,
      on: shown === undefined || shown.has(value),
    }));
    return [
      {
        key,
        label: localize(type.label, [locale]) || key,
        on: type.on_at_start !== false,
        mode: classifyingProperty(type) === type.process?.property ? ('stage' as const) : ('values' as const),
        values,
      },
    ];
  });
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);

/** Applies the chosen start state of each listed Objektart; one not listed stays as it is. */
export function setStartTypes(doc: Doc, types: StartTypes): SettingsEdit {
  const file = doc.effective();
  let cur = doc;
  for (const [key, want] of Object.entries(types)) {
    const type = file.types?.[key];
    if (type?.geometry === undefined) return { ok: false, code: 'invalid' };
    const options = optionsOf(type, 'de').map((o) => o.key);
    // In the order the property declares them; all of them means "absent" (all on).
    const chosen = want.values === null ? null : options.filter((o) => want.values?.includes(o));
    if (want.values !== null && (options.length === 0 || want.values.some((v) => !options.includes(v))))
      return { ok: false, code: 'invalid' };
    const values = chosen !== null && chosen.length < options.length ? chosen : null;

    if (want.on !== (type.on_at_start !== false)) {
      const r = cur.apply({ kind: 'set', path: `types.${key}.on_at_start`, value: want.on });
      if (r.refused) return { ok: false, code: 'refused', detail: r.refused.message };
      cur = r.doc;
    }
    if (values === null) {
      if (type.values_at_start === undefined) continue;
      const r = clearPath(
        cur,
        `types.${key}.values_at_start`,
        (f) => f.types?.[key]?.values_at_start !== undefined,
      );
      if (!r.ok) return r;
      cur = r.doc;
    } else if (!sameList(type.values_at_start, values)) {
      const r = cur.apply({ kind: 'set', path: `types.${key}.values_at_start`, value: values });
      if (r.refused) return { ok: false, code: 'refused', detail: r.refused.message };
      cur = r.doc;
    }
  }
  return { ok: true, doc: cur };
}
