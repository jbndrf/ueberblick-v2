/**
 * Where a key path of the file sits in the zoom `Project > feature type > task` (docs/08). Pure functions
 * over the effective file; the v3 builder shell and the problems list share them (R1).
 */
import {
  parseKeyPath,
  localize,
  TASK_OFFERS,
  type KeyPath,
  type LocalizedString,
  type TemplateFile,
} from '@ueberblick/core';

/** A place in the zoom. A task is always under a type (or a special offer such as `$map`). */
export interface Location {
  readonly type?: string;
  readonly task?: string;
}

/** `localize()` of core for one UI locale; `fallback` (usually the key) stands for a missing label. */
export function labelOf(label: LocalizedString | undefined, locale: string, fallback: string): string {
  return label === undefined ? fallback : localize(label, [locale]);
}

/** The type key a task is shown under: its first `on` feature type, else its `creates`, else its offer. */
export function taskLocation(file: TemplateFile, task: string): Location {
  const t = file.tasks?.[task];
  if (t === undefined) return {};
  const on = Array.isArray(t.on) ? t.on[0] : t.on;
  const offer = (TASK_OFFERS.keys as readonly string[]).includes(on ?? '');
  const type = offer ? (t.creates ?? on) : on;
  return type === undefined ? {} : { type, task };
}

/** The location that shows the entity a key path points into (the project when it is not a type or task). */
export function locate(file: TemplateFile, path: KeyPath): Location {
  const seg = parseKeyPath(path);
  const [area, key] = seg ?? [];
  if (key === undefined) return {};
  if (area === 'types') return { type: key };
  if (area === 'tasks') return taskLocation(file, key);
  return {};
}
