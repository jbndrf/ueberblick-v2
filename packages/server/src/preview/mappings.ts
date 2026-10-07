/**
 * The automatic mappings of a preview refresh (WP-341, A-031 item 2). A preview holds throw-away demo data, so a
 * breaking draft change never asks: a removed option moves its values to the first remaining option of that property
 * (for the process property: the process `start`), a removed property discards them. Nothing here is a rule about
 * what a change means: `core.diff` says what changed, `checkMappings` of the deploy validates what we answer.
 */
import { parseKeyPath, type DiffEntry, type TemplateFile } from '@ueberblick/core';
import type { ValueMapping } from '../deploy';

interface PropertyShape {
  readonly options?: Readonly<Record<string, unknown>>;
}
interface TypeShape {
  readonly process?: { readonly property: string; readonly start: string };
  readonly properties?: Readonly<Record<string, PropertyShape>>;
}

/** The option a value of the removed option `gone` moves to, or undefined when no option remains. */
function target(type: TypeShape | undefined, property: string, gone: string): string | undefined {
  const options = Object.keys(type?.properties?.[property]?.options ?? {}).filter((o) => o !== gone);
  const start = type?.process?.property === property ? type.process.start : undefined;
  return start !== undefined && options.includes(start) ? start : options[0];
}

/** Mappings for every breaking removal of an option or a property in `changes`; `effective` is the new file. */
export function previewMappings(
  changes: readonly DiffEntry[],
  effective: TemplateFile,
): Record<string, ValueMapping> {
  const types = effective.types as Readonly<Record<string, TypeShape>> | undefined;
  const out: Record<string, ValueMapping> = {};
  for (const e of changes) {
    if (!e.breaking || e.change !== 'removed') continue;
    const [section, type, kind, property, sub, option] = parseKeyPath(e.path) ?? [];
    if (section !== 'types' || kind !== 'properties' || type === undefined || property === undefined)
      continue;
    const segments = parseKeyPath(e.path)?.length;
    if (segments === 4) out[e.path] = { discard: true };
    else if (segments === 6 && sub === 'options' && option !== undefined) {
      const to = target(types?.[type], property, option);
      out[e.path] = to === undefined ? { discard: true } : { to };
    }
  }
  return out;
}
