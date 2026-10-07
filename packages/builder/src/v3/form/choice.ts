/**
 * v3's Smart Dropdown (`SmartDropdownConfig` and `SmartDropdownMappingModal`, register a3-builder row 166) as the
 * `choice_filter` of the form entry (A-039, docs/05): "Quellfeld" is the earlier select the filter reads, and the
 * checklist of "Optionen wenn „x“ ausgewählt ist" is one branch per source value. The expression the builder writes
 * (and reads back) has exactly one shape:
 *
 *   form.<q> == '<v>' ? option in ['a', 'b'] : form.<q> == '<w>' ? option in ['c'] : false
 *
 * (`'<v>' in form.<q>` when the source is a multiselect; `true` for a Smart Dropdown without a source). A source
 * value with an empty checklist is a real branch with an empty list (`... ? option in [] : false`: it offers nothing,
 * docs/05), so a source with nothing ticked yet keeps its source. Any other expression is `foreign`: the panel shows
 * it read-only and leaves it alone (R5: it is the rule language, not a builder format). Pure, no DOM.
 */
import { type Json, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { setFieldAttrOps } from '../../lenses/task/edit';
import { addOptionOp, optionKeyFor } from '../field/ops';
import { literalText } from '../../shell/conditions/chips';
import { labelOf } from '../../shell/location';
import { editorModel, formOf } from './model';

export interface ChoiceBranch {
  /** The source value (an option key of the source field). */
  readonly when: string;
  /** The option keys of this field that are offered then, in the field's own order. */
  readonly options: readonly string[];
}

export type ChoiceFilter =
  | { readonly kind: 'none' }
  /** `true`: a Smart Dropdown that has no source yet and offers every option. */
  | { readonly kind: 'open' }
  | {
      readonly kind: 'smart';
      readonly source: string;
      /** At least one branch (a branch may have no options): `smartFilter` seeds the first. */
      readonly branches: readonly [ChoiceBranch, ...ChoiceBranch[]];
    }
  | { readonly kind: 'foreign'; readonly expr: string };

const Q = String.raw`'(?:[^'\\]|\\.)*'`;
const KEY = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
const BRANCH = new RegExp(
  String.raw`^(?:form\.(${KEY}) == (${Q})|(${Q}) in form\.(${KEY})) \? option in \[((?:${Q}(?:, ${Q})*)?)\] : `,
);
const ONE = new RegExp(Q, 'g');

/** The text of a quoted literal, when quoting it again gives the same literal (else the shape is not ours). */
function unquote(quoted: string): string | undefined {
  const text = quoted.slice(1, -1).replace(/\\(.)/g, '$1');
  return literalText(text) === quoted ? text : undefined;
}

/** Reads a form entry's `choice_filter`. */
export function parseChoiceFilter(source: string | undefined): ChoiceFilter {
  if (source === undefined) return { kind: 'none' };
  const foreign: ChoiceFilter = { kind: 'foreign', expr: source };
  if (source === 'true') return { kind: 'open' };
  const branches: ChoiceBranch[] = [];
  let from: string | undefined;
  let rest = source;
  while (rest !== 'false') {
    const m = BRANCH.exec(rest);
    if (m === null) return foreign;
    const name = (m[1] ?? m[4]) as string;
    const when = unquote((m[2] ?? m[3]) as string);
    if (when === undefined || (from !== undefined && from !== name)) return foreign;
    from = name;
    const options = ((m[5] ?? '').match(ONE) ?? []).map(unquote);
    if (options.some((o) => o === undefined) || branches.some((b) => b.when === when)) return foreign;
    branches.push({ when, options: options as string[] });
    rest = rest.slice(m[0].length);
  }
  const [head, ...tail] = branches;
  return from === undefined || head === undefined
    ? foreign
    : { kind: 'smart', source: from, branches: [head, ...tail] };
}

/** A fresh filter on `source`: nothing is offered yet, under the first source option. No options: it stays open. */
export function smartFilter(source: SmartSource): ChoiceFilter {
  const first = source.options[0];
  return first === undefined
    ? { kind: 'open' }
    : { kind: 'smart', source: source.key, branches: [{ when: first.key, options: [] }] };
}

/** The source of a filter. `multi`: the source is a multiselect (`'v' in form.q`), else a select (`form.q == 'v'`). */
export function choiceFilterOf(filter: ChoiceFilter, multi: boolean): string | undefined {
  switch (filter.kind) {
    case 'none':
      return undefined;
    case 'open':
      return 'true';
    case 'foreign':
      return filter.expr;
    case 'smart': {
      const test = (when: string): string =>
        multi
          ? `${literalText(when)} in form.${filter.source}`
          : `form.${filter.source} == ${literalText(when)}`;
      const list = (o: readonly string[]): string => literalText([...o] as Json);
      return `${filter.branches.map((b) => `${test(b.when)} ? option in ${list(b.options)} : `).join('')}false`;
    }
  }
}

/** One checkbox: option `option` is offered (or not) when the source is `when`. `order` is the field's option order. */
export function toggleOption(
  filter: ChoiceFilter,
  when: string,
  option: string,
  on: boolean,
  order: readonly string[],
): ChoiceFilter {
  if (filter.kind !== 'smart') return filter;
  const have = new Set(filter.branches.find((b) => b.when === when)?.options ?? []);
  if (on) have.add(option);
  else have.delete(option);
  const options = order.filter((o) => have.has(o));
  const rest = filter.branches.map((b) => (b.when === when ? { when, options } : b));
  const [head, ...tail] = filter.branches.some((b) => b.when === when) ? rest : [...rest, { when, options }];
  return { ...filter, branches: [head as ChoiceBranch, ...tail] };
}

/** The ops that write `filter` as the form entry's `choice_filter`; none when the file already says it. */
export function choiceOps(
  doc: Doc,
  task: string,
  key: string,
  filter: ChoiceFilter,
  multi: boolean,
): readonly Op[] {
  const source = choiceFilterOf(filter, multi);
  if (formOf(doc.effective(), task)[key]?.choice_filter === source) return [];
  return setFieldAttrOps(doc, task, key, 'choice_filter', source);
}

export interface SourceOption {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
}

/** An earlier select of this form: what v3's source picker lists ("Quellfeld"). */
export interface SmartSource {
  readonly key: string;
  readonly label: string;
  readonly multi: boolean;
  /** The form page it sits on, 0-based (v3 grouped the sources by stage). */
  readonly page: number;
  readonly options: readonly SourceOption[];
}

const textOf = (v: LocalizedString | undefined, locale: string, key: string): string =>
  v === undefined ? '' : labelOf(v, locale, key);

/** The options of a select or multiselect property, with the explanation text of each. */
export function optionsOf(file: TemplateFile, type: string, key: string, locale: string): SourceOption[] {
  const prop = file.types?.[type]?.properties[key];
  return Object.entries(prop?.options ?? {}).map(([k, label]) => ({
    key: k,
    label: labelOf(label as LocalizedString, locale, k),
    hint: textOf(prop?.option_hints?.[k] as LocalizedString | undefined, locale, ''),
  }));
}

/** The selects before `key` in the form of `task`, in form order. */
export function smartSourcesOf(
  file: TemplateFile,
  task: string,
  fallback: string,
  key: string,
  locale: string,
): SmartSource[] {
  const model = editorModel(file, task, fallback, locale);
  const props = file.types?.[model.type]?.properties ?? {};
  const out: SmartSource[] = [];
  for (const [page, p] of model.layout.pages.entries()) {
    for (const cell of p.lines.flat()) {
      if (cell.key === key) return out;
      const prop = props[cell.key];
      if (prop?.type !== 'select' && prop?.type !== 'multiselect') continue;
      out.push({
        key: cell.key,
        label: labelOf(prop.label, locale, cell.key),
        multi: prop.type === 'multiselect',
        page,
        options: optionsOf(file, model.type, cell.key, locale),
      });
    }
  }
  return out;
}

/**
 * A new option typed in the mapping dialog (v3's textarea created options on the spot): it joins the field's
 * options and is offered for `when`, in one batch.
 */
export function addOfferedOptionOps(
  doc: Doc,
  task: string,
  type: string,
  key: string,
  filter: ChoiceFilter,
  when: string,
  label: string,
  locale: string,
  multi: boolean,
): readonly Op[] {
  const file = doc.effective();
  const option = optionKeyFor(file, type, key, label);
  const add = addOptionOp(file, type, key, label, locale);
  const after = doc.apply(add).doc;
  const order = Object.keys(after.effective().types?.[type]?.properties[key]?.options ?? {});
  return [add, ...choiceOps(after, task, key, toggleOption(filter, when, option, true, order), multi)];
}
