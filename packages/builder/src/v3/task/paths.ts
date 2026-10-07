/**
 * The left-hand sides a Bedingungen row can choose (v3's field select): the properties of the type the
 * task is offered on, and who runs it. A property whose value is not a scalar the rule language compares
 * (a geometry, a file, a localized text, a list) is left out. No DOM.
 */
import type { PropertyTypeKey, TemplateFile } from '@ueberblick/core';
import type { Json } from '@ueberblick/core';
import { labelOf } from '../../shell/location';
import { onView } from '../../lenses/task/model';

/** The property types a row compares with `==`, `<`, `in` and so on (typed by the registry's keys). */
export const COMPARABLE_TYPES = [
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'select',
  'participant',
  'reference',
] as const satisfies readonly PropertyTypeKey[];

export interface PathOption {
  readonly value: string;
  readonly label: string;
  /** The property's type; none for `actor.id`. */
  readonly type?: PropertyTypeKey;
  /** For a select: its option keys, the first of which a new row starts with. */
  readonly options?: readonly string[];
}

export function pathOptions(
  file: TemplateFile,
  task: string,
  locale: string,
  actorLabel: string,
): readonly PathOption[] {
  const def = file.tasks?.[task];
  const on = def === undefined ? undefined : onView(def.on);
  const type = on?.kind === 'types' ? on.types[0] : undefined;
  const props = type === undefined ? {} : (file.types?.[type]?.properties ?? {});
  const own = Object.entries(props)
    .filter(([, p]) => (COMPARABLE_TYPES as readonly string[]).includes(p.type))
    .map(([k, p]): PathOption => {
      const options = p.type === 'select' && p.options !== undefined ? Object.keys(p.options) : undefined;
      return {
        value: `self.${k}`,
        label: labelOf(p.label, locale, k),
        type: p.type,
        ...(options === undefined ? {} : { options }),
      };
    });
  return [...own, { value: 'actor.id', label: actorLabel }];
}

/**
 * The value a new row on `path` starts with, one the checker accepts for the property's type: the first
 * option of a select, empty text, 0 or true; anything else starts as "ist leer" (`== null`).
 */
export function startValue(path: PathOption | undefined): Json {
  switch (path?.type) {
    case 'select':
      return path.options?.[0] ?? null;
    case 'text':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return true;
    default:
      return null;
  }
}

/**
 * The left-hand sides of a `then` step's "nur wenn" row: what the task offers (`pathOptions`) and the
 * values typed in its form (`form.<field>`), as the checker's environment knows them for `then.when`.
 */
export function stepPathOptions(
  file: TemplateFile,
  task: string,
  locale: string,
  actorLabel: string,
  formLabel: (property: string) => string,
): readonly PathOption[] {
  const def = file.tasks?.[task];
  const type = def?.creates ?? (def === undefined ? undefined : onViewType(def.on));
  const props = type === undefined ? {} : (file.types?.[type]?.properties ?? {});
  const fromForm = Object.keys(def?.form ?? {}).flatMap((k): PathOption[] => {
    const p = props[k];
    if (p === undefined || !(COMPARABLE_TYPES as readonly string[]).includes(p.type)) return [];
    const options = p.type === 'select' && p.options !== undefined ? Object.keys(p.options) : undefined;
    return [
      {
        value: `form.${k}`,
        label: formLabel(labelOf(p.label, locale, k)),
        type: p.type,
        ...(options === undefined ? {} : { options }),
      },
    ];
  });
  const own = pathOptions(file, task, locale, actorLabel);
  return [...own.slice(0, -1), ...fromForm, ...own.slice(-1)];
}

const onViewType = (on: string | readonly string[]): string | undefined => {
  const v = onView(on);
  return v.kind === 'types' ? v.types[0] : undefined;
};
