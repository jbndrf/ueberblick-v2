/**
 * The words of a compile problem in the admin's language (WP-416). Core hands over typed `params`
 * (and an English `message` for logs and assistants); the builder catalogue
 * (`builder_problem_<code>[_<variant>]` and `..._hint`) words them. One function, used by the panel and
 * the HTTP route (R1). A code without an entry in the requested locale is a bug, not a fallback (R11).
 */
import {
  localize,
  type DanglingKind,
  type ExprErrorCode,
  type Problem,
  type ProblemCode,
  type ProblemParams,
} from '@ueberblick/core';
import { messages, type MessageKey } from '../shell/messages';

/** The catalogue keys a code can use (the type proves that every code has a message and a hint entry). */
type CodeKey = `problem_${ProblemCode}`;
type HintKey = `problem_${Exclude<ProblemCode, 'schema_invalid'>}_hint`;
type WhatKey = `problem_what_${DanglingKind}`;
type ExprKey = `expr_${ExprErrorCode}`;
// Compile-time: a code, hint or noun without a catalogue entry stops the typecheck.
type Present<K extends string> = [K] extends [MessageKey] ? true : never;
export const CATALOGUE_COMPLETE: Present<CodeKey> & Present<HintKey> & Present<WhatKey> & Present<ExprKey> =
  true;

export interface ProblemText {
  readonly message: string;
  readonly hint?: string;
}

/** The key of a code's wording: `problem_<code>`, or `problem_<code>_<variant>` when the problem names one. */
export function problemKey(code: ProblemCode, variant: string | undefined): string {
  return variant === undefined ? `problem_${code}` : `problem_${code}_${variant}`;
}

function translate(locale: string, key: string, params: ProblemParams): string {
  try {
    return messages(locale)(key as MessageKey, params);
  } catch {
    throw new Error(`builder message ${key} is missing`);
  }
}

/** The key of an expression error's hint: `expr_<code>_hint`, or `expr_<code>_hint_<variant>` (registry hints). */
export function exprHintKey(code: string, variant: string): string {
  return variant === 'default' ? `expr_${code}_hint` : `expr_${code}_hint_${variant}`;
}

/** `matches` problems carry a registry key (`detail`, `feature`); each key has its own wording (`expr_matches_*_<key>`). */
function matchesWords(locale: string, code: string, params: ProblemParams): ProblemParams {
  if (code === 'matches_pattern_syntax')
    return {
      ...params,
      detail: translate(locale, `expr_matches_syntax_${String(params['detail'])}`, params),
    };
  if (code === 'matches_pattern_unsupported')
    return {
      ...params,
      feature: translate(locale, `expr_matches_unsupported_${String(params['feature'])}`, params),
    };
  return params;
}

/**
 * The detail of an expression problem: the parser's or checker's error (`params.expr_code` and its own params)
 * worded in `locale`. What the parser found (`found_kind`) is worded first.
 */
function exprDetail(locale: string, rawParams: ProblemParams): string {
  const code = String(rawParams['expr_code']);
  const params = matchesWords(locale, code, rawParams);
  const kind = params['found_kind'];
  if (typeof kind !== 'string') return translate(locale, `expr_${code}`, params);
  const found =
    kind === 'token' ? `„${String(params['found'])}“` : translate(locale, `expr_found_${kind}`, params);
  return translate(locale, `expr_${code}`, { ...params, found });
}

/** Message and hint of one problem in `locale`. */
export function problemText(p: Problem, locale: string): ProblemText {
  const english = localize(p.message, ['en']);
  const params = p.params ?? (p.code === 'schema_invalid' ? { detail: english } : undefined);
  // A problem that did not come from compile (a deploy check) has no params: its English text is all there is.
  if (params === undefined) return { message: english, ...(p.hint === undefined ? {} : { hint: p.hint }) };
  const what = params['what'];
  const filled: ProblemParams =
    typeof what === 'string'
      ? { ...params, noun: translate(locale, `problem_what_${what}`, params) }
      : params;
  const variant = typeof params['variant'] === 'string' ? params['variant'] : undefined;
  const key = problemKey(p.code, variant);
  const exprCode = params['expr_code'];
  const hintVariant = params['hint_variant'];
  const hintKey =
    typeof exprCode === 'string' && typeof hintVariant === 'string'
      ? exprHintKey(exprCode, hintVariant)
      : `${key}_hint`;
  const detailed: ProblemParams =
    typeof exprCode === 'string' ? { ...filled, detail: exprDetail(locale, params) } : filled;
  return {
    message: translate(locale, key, detailed),
    // `schema_invalid` has no hint entry (its detail is the schema's own words): the hint is left out.
    ...(p.hint === undefined || p.code === 'schema_invalid'
      ? {}
      : { hint: translate(locale, hintKey, filled) }),
  };
}
