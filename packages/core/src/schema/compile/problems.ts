import type { MergeIssue } from '../../template/contract';
import { PROBLEM_VARIANTS, type DanglingKind, type ProblemCode } from '../../registry/compile';
import type { Problem, ProblemParams } from './contract';
import type { LocalizedString } from '../primitives';

type Span = { readonly start: number; readonly end: number };

/** The English noun of a dangling kind, for the compiler's own `message` (the builder words it by kind). */
const NOUNS: Readonly<Record<DanglingKind, (of: string, to: string) => string>> = {
  feature_type: () => 'feature type',
  property: () => 'property',
  property_of: (of) => `property of ${of}`,
  task_subject_property: () => 'property of the task subject',
  participant_property_of: (of) => `participant property of ${of}`,
  reference_property_of: (of, to) => `reference property of ${of} that points at ${to}`,
  task: () => 'task',
  view: () => 'view',
  role: () => 'role',
  option: () => 'option',
  option_of: (of) => `option of ${of}`,
  bound_feature: () => 'bound feature',
  personal_subject: () => 'personal subject',
};

/** Collects problems (blocking) and warnings (compile still succeeds) while compile() walks a file. */
export class Sink {
  readonly problems: Problem[] = [];
  readonly warnings: Problem[] = [];

  /**
   * `params` are the values the message is made of; the builder words the problem from them in the admin's
   * language. `message` and `hint` stay English, for logs, the MCP route and assistants.
   */
  error(
    path: string,
    code: ProblemCode,
    message: string | LocalizedString,
    hint: string,
    params: ProblemParams,
    span?: Span,
  ): void {
    this.problems.push(build(path, code, message, hint, params, span));
  }

  warn(
    path: string,
    code: ProblemCode,
    message: string | LocalizedString,
    hint: string,
    params: ProblemParams,
    span?: Span,
  ): void {
    this.warnings.push(build(path, code, message, hint, params, span));
  }

  /** `dangling_reference` with the standard hint: name what exists. */
  dangling(
    path: string,
    what: DanglingKind,
    value: string,
    existing: readonly string[],
    extra: { readonly of?: string; readonly to?: string } = {},
  ): void {
    const noun = NOUNS[what](extra.of ?? '', extra.to ?? '');
    const hint = existing.length > 0 ? `use one of: ${existing.join(', ')}` : `declare the ${noun} first`;
    const params: ProblemParams = {
      value,
      what,
      existing: existing.join(', '),
      ...(extra.of === undefined ? {} : { of: extra.of }),
      ...(extra.to === undefined ? {} : { to: extra.to }),
      ...(existing.length > 0 ? {} : { variant: 'declare_first' }),
    };
    this.error(path, 'dangling_reference', `'${value}' is not a known ${noun}`, hint, params);
  }
}

function build(
  path: string,
  code: ProblemCode,
  message: string | LocalizedString,
  hint: string,
  params: ProblemParams,
  span: Span | undefined,
): Problem {
  const variant = params['variant'];
  if (variant !== undefined && !PROBLEM_VARIANTS.has(`${code}.${String(variant)}`)) {
    throw new Error(`problem ${code} names the variant '${String(variant)}', which PROBLEM_VARIANTS lacks`);
  }
  return span ? { path, code, message, hint, params, span } : { path, code, message, hint, params };
}

const MERGE_HINTS: Record<MergeIssue['code'], string> = {
  lock_violation: 'remove this entry from the overlay: the template locks the path',
  unknown_path: 'address a path that exists in the template, or use `add` for a new element',
  path_exists: 'use `override` to change an existing element; `add` is for new ones',
  hidden_referenced: 'remove the reference to the hidden element, or stop hiding it',
};

/** Turns the issues that `template.merge` reports into problems (the merge sees overlay and lock). */
export function problemsFromMergeIssues(issues: readonly MergeIssue[]): readonly Problem[] {
  return issues.map((i) => ({
    path: i.path,
    code: i.code,
    message: i.message,
    hint: MERGE_HINTS[i.code],
    params: i.params,
  }));
}
