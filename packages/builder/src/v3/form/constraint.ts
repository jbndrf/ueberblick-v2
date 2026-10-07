/**
 * The rules the field panel writes into a form entry's `constraint` (v3 "Validierung" and "Änderung vor dem Absenden
 * erforderlich", register a3-builder rows 162 and 163, E12): the length of a text, its pattern (`matches`, RE2 subset),
 * the step of a number (`multiple_of(value, step)`, exact for decimals), the number of choices of a multiselect and "the value must change".
 * The constraint is one rule-language expression (R5), built from these parts joined by `&&` and read back by the
 * same grammar.
 * A constraint that is not made of them (written in the Code view, say) is `foreign`: the panel leaves it alone and
 * says so. Pure, no DOM.
 */
import { check, parse, T } from '@ueberblick/core/expr/compile';

/** The most decimal places of a step (the rule language's `MULTIPLE_OF_MAX_PLACES`). */
export const STEP_MAX_PLACES = 9;
const STEP_TEXT = /^(?:[1-9]\d*|0)(?:\.\d{1,9})?$/;

/** Is this a step the rule language checks exactly: written plainly (no exponent), above 0, at most 9 places? */
export const isValidStep = (step: number): boolean =>
  Number.isFinite(step) && step > 0 && STEP_TEXT.test(String(step));

export interface Rules {
  readonly minLength?: number;
  readonly maxLength?: number;
  /** The text must contain a match of this pattern (`matches(value, '<pattern>')`; anchor with `^` and `$`). */
  readonly pattern?: string;
  /** The number must be a multiple of this step: above 0, at most `STEP_MAX_PLACES` decimal places (WP-457). */
  readonly step?: number;
  /** "The value must change": true when the constraint holds `value != <the prefill>`. */
  readonly change?: boolean;
}

/** A change of the rules: a key with `undefined` removes that rule. */
export type RulesPatch = { readonly [K in keyof Rules]?: Rules[K] | undefined };

/** The rules after a patch; removed rules leave no key. */
export function mergeRules(rules: Rules, patch: RulesPatch): Rules {
  const merged: { [K in keyof Rules]?: Rules[K] | undefined } = { ...rules, ...patch };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as Rules;
}

export type ParsedConstraint =
  { readonly foreign: false; readonly rules: Rules } | { readonly foreign: true };

const SIMPLE = /^[\w.]+$|^'(?:[^'\\]|\\.)*'$/;

/** The prefill as the right-hand side of `!=`: a bare name, path, number or string stays as it is, anything else gets parentheses. */
const operand = (calculate: string): string => (SIMPLE.test(calculate) ? calculate : `(${calculate})`);

/** A string literal: `\` and `'` escaped, control characters as `\uXXXX`, everything else as it is. */
function quote(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (ch === '\\' || ch === "'") out += `\\${ch}`;
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `'${out}'`;
}

/** The text of the inner part of a literal `quote` wrote; `undefined` when it holds any other escape. */
function unquote(inner: string): string | undefined {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const e = inner[i + 1];
    if (e === '\\' || e === "'") out += e;
    else if (e === 'u' && /^[0-9a-f]{4}$/.test(inner.slice(i + 2, i + 6))) {
      out += String.fromCharCode(Number.parseInt(inner.slice(i + 2, i + 6), 16));
      i += 4;
    } else return undefined;
    i++;
  }
  return out;
}

/** The constraint the rules say, or `undefined` when there are none. `calculate` is the prefill the value must differ from. */
export function constraintOf(rules: Rules, calculate: string | undefined): string | undefined {
  const parts: string[] = [];
  if (rules.minLength !== undefined) parts.push(`size(value) >= ${rules.minLength}`);
  if (rules.maxLength !== undefined) parts.push(`size(value) <= ${rules.maxLength}`);
  if (rules.pattern !== undefined) parts.push(`matches(value, ${quote(rules.pattern)})`);
  if (rules.step !== undefined) parts.push(`multiple_of(value, ${rules.step})`);
  if (rules.change === true && calculate !== undefined) parts.push(`value != ${operand(calculate)}`);
  return parts.length === 0 ? undefined : parts.join(' && ');
}

/** What is wrong with a pattern: the check error's code and params (`matches_pattern_*`), or `undefined` when it is valid. */
export function patternProblem(
  pattern: string,
): { readonly code: string; readonly params: Readonly<Record<string, string | number>> } | undefined {
  const parsed = parse(`matches(value, ${quote(pattern)})`);
  if (!parsed.ok) return { code: 'matches_pattern_syntax', params: { detail: 'bad_escape', at: 0 } };
  const result = check(parsed.ast, { vars: { value: T.string }, features: {} });
  const error = result.ok ? undefined : result.errors.find((e) => e.code.startsWith('matches_pattern_'));
  return error === undefined ? undefined : { code: error.code, params: error.params };
}

/** The top-level `&&` parts of a source: not inside parentheses, brackets or quotes. */
function split(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoteChar = '';
  let from = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] as string;
    if (quoteChar !== '') {
      if (ch === '\\') i++;
      else if (ch === quoteChar) quoteChar = '';
    } else if (ch === "'" || ch === '"') quoteChar = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0 && source.startsWith('&&', i)) {
      parts.push(source.slice(from, i).trim());
      from = i + 2;
      i++;
    }
  }
  parts.push(source.slice(from).trim());
  return parts;
}

/** Reads a constraint back; `foreign` when any part is not one of the five, or one appears twice. */
export function parseConstraint(source: string | undefined, calculate: string | undefined): ParsedConstraint {
  if (source === undefined) return { foreign: false, rules: {} };
  let rules: Rules = {};
  for (const part of split(source)) {
    const min = /^size\(value\) >= (\d+)$/.exec(part);
    const max = /^size\(value\) <= (\d+)$/.exec(part);
    const pattern = /^matches\(value, '((?:[^'\\]|\\.)*)'\)$/.exec(part);
    const text = pattern === null ? undefined : unquote(pattern[1] as string);
    const stepMatch = /^multiple_of\(value, (\d+(?:\.\d+)?)\)$/.exec(part);
    const step = stepMatch !== null && isValidStep(Number(stepMatch[1])) ? stepMatch : null;
    if (min !== null && rules.minLength === undefined) rules = { ...rules, minLength: Number(min[1]) };
    else if (max !== null && rules.maxLength === undefined) rules = { ...rules, maxLength: Number(max[1]) };
    else if (text !== undefined && rules.pattern === undefined) rules = { ...rules, pattern: text };
    else if (step !== null && rules.step === undefined) rules = { ...rules, step: Number(step[1]) };
    else if (
      calculate !== undefined &&
      part === `value != ${operand(calculate)}` &&
      rules.change === undefined
    )
      rules = { ...rules, change: true };
    else return { foreign: true };
  }
  return { foreign: false, rules };
}
