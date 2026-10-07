import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SYSTEM_FIELDS } from '../../registry';
import { EXPR_ERRORS, type ExprErrorCode, type ExprErrorParams } from '../../registry/expr-errors';
import type { Expr } from '../ast';
import { CHECK_DEVICE_ERR, CHECK_ERR, CHECK_EXPECT, DEVICE_ENV, ENV } from '../__fixtures__/check-cases';
import { PARSE_ERR } from '../__fixtures__/parse-cases';
import { parse } from '../parse';
import { check, T, type Env } from '.';

interface Found {
  readonly code: ExprErrorCode | undefined;
  readonly params: ExprErrorParams | undefined;
  readonly hint: string | undefined;
}

/** What `parse` and then `check` report for `src`: every error with its code and params. */
function found(src: string, env: Env = ENV, expect_?: Parameters<typeof check>[2]): Found[] {
  const p = parse(src);
  if (!p.ok) return p.errors.map((e) => ({ code: e.code, params: e.params, hint: undefined }));
  const r = check(p.ast, env, expect_);
  return r.ok ? [] : r.errors.map((e) => ({ code: e.code, params: e.params, hint: e.hint }));
}

/** [source, expected code, expected params (a subset), environment]. */
const CORPUS: readonly (readonly [string, ExprErrorCode, ExprErrorParams, Env?])[] = [
  ['0x', 'hex_digits_missing', {}],
  ['1u', 'unsigned_unsupported', {}],
  ['0x10u', 'unsigned_unsupported', {}],
  ['0xFFFFFFFFFFFFFFFFFF', 'int_out_of_range', {}],
  ['1abc', 'number_runs_into_name', {}],
  ['1e999', 'number_out_of_range', {}],
  ["'''x'''", 'triple_quote_unsupported', {}],
  ["'a\nb'", 'string_newline', {}],
  ["'\\x1'", 'escape_hex_invalid', { escape: 'x', digits: 2 }],
  ["'\\U00110000'", 'escape_code_point_invalid', {}],
  ["'\\q'", 'escape_unknown', { escape: 'q' }],
  ["'abc", 'string_unterminated', {}],
  ["r'abc'", 'raw_bytes_unsupported', {}],
  ['a & b', 'operator_doubled', { char: '&' }],
  ['a = b', 'assign_unsupported', {}],
  ['a # b', 'character_unexpected', { char: '#' }],
  ['(1', 'expected_punct', { expected: ')', found_kind: 'end' }],
  ['[1, 2', 'expected_punct', { expected: ']', found_kind: 'end' }],
  ['a.1', 'expected_field_name', { found_kind: 'number' }],
  ['a +', 'unexpected_end', {}],
  ['as', 'reserved_word', { name: 'as' }],
  ['a.in', 'keyword_as_name', { name: 'in' }],
  ['a {', 'struct_unsupported', {}],
  ['1 2', 'unexpected_token', { found_kind: 'number' }],
  ['1 )', 'unexpected_token', { found_kind: 'token', found: ')' }],
  ['{1: 2}.x[', 'unexpected_end', {}],
  [`${'('.repeat(70)}1${')'.repeat(70)}`, 'nested_too_deep', { max: 64 }],
  [`${'1+'.repeat(20_000)}1`, 'too_long', { max: 32_768 }],
  ['a.exists(1)', 'macro_arguments', { macro: 'exists' }],
  ['has(a)', 'has_arguments', {}],
  ['-self.stage', 'minus_operand', { actual: 'string' }],
  ["self.alter > 3 ? 'a' : 1", 'branch_types_differ', { left: 'string', right: 'int' }],
  ['{1.5: 1}', 'map_key_type', { actual: 'double' }],
  ['!self.alter', 'not_operand', { expected: 'bool', actual: 'int' }],
  ['self.alter ? 1 : 2', 'condition_type', { expected: 'bool', actual: 'int' }],
  ["self.tags['a']", 'list_index_type', { expected: 'int', actual: 'string' }],
  ['self.meta[1]', 'map_lookup_type', { expected: 'string', actual: 'int' }],
  ['self.tags.exists(t, t)', 'predicate_type', { macro: 'exists', expected: 'bool', actual: 'string' }],
  ["last('stage', 'x')", 'count_type', { expected: 'int', actual: 'string' }],
  ['zzz', 'unknown_name', { name: 'zzz', hint_variant: 'known' }],
  ['selff.stage', 'unknown_name', { name: 'selff', near: 'self', hint_variant: 'near' }],
  ['self.stage', 'unknown_feature_type', { type: 'baum' }, { ...ENV, features: {} }],
  ['actor.rolle', 'no_property_on_record', { field: 'rolle', hint_variant: 'near' }],
  ['actor.role', 'no_role_property', {}],
  ['self.stag', 'no_property_on_type', { field: 'stag', type: 'baum', near: 'stage' }],
  ['self.tags.length', 'list_field', { field: 'length' }],
  ['self.hoehe.foo', 'cannot_read_field', { field: 'foo', actual: 'double' }],
  ['self[form.art]', 'record_index', {}],
  ['self.stage[0]', 'cannot_index', { actual: 'string' }],
  ['has(self.alter.x)', 'has_operand', { actual: 'int' }],
  ['self.alter.exists(x, x)', 'macro_range', { macro: 'exists', actual: 'int' }],
  ['self.alter && true', 'op_needs_bool', { op: '&&', left: 'int', right: 'bool' }],
  ['self.stage == 3', 'op_compares_different', { op: '==', left: 'string', right: 'int' }],
  ['self.stage > 3', 'op_cannot_order', { op: '>', left: 'string', right: 'int' }],
  ['1 in 2', 'op_in_mismatch', { op: 'in', left: 'int', right: 'int' }],
  ['self.hoehe % 2', 'op_needs_int', { op: '%', left: 'double', right: 'int' }],
  ['self.tags + [1]', 'op_lists_differ', { op: '+', left: 'list<string>', right: 'list<int>' }],
  ['self.stage * 2', 'op_not_applicable', { op: '*', left: 'string', right: 'int' }],
  ['nofunc(1)', 'unknown_function', { name: 'nofunc' }],
  ['self.stage.startsWith(1)', 'no_signature', { call: 'string.startsWith(int)' }],
  ["last('stage')", 'history_arity', { name: 'last', count: 2 }],
  ["changed('stage')", 'history_needs_self', { name: 'changed' }, { ...ENV, vars: { now: T.timestamp } }],
  ['changed(1)', 'history_property_literal', { name: 'changed' }],
  ["changed('stag')", 'unknown_property', { property: 'stag', type: 'baum', near: 'stage' }],
  ["last('stage', 0)", 'count_minimum', {}],
  ["last('stage', 11)", 'device_history_limit', { limit: 10 }, DEVICE_ENV],
  ["last('stage', self.alter)", 'device_count_literal', {}, DEVICE_ENV],
  ['matches(self.stage, self.stage)', 'matches_pattern_literal', {}],
  [`matches(self.stage, '${'a'.repeat(201)}')`, 'matches_pattern_too_long', { max: 200 }],
  ["matches(self.stage, '(a')", 'matches_pattern_syntax', { detail: 'unclosed_group', at: 0 }],
  ["self.stage.matches('a(?=b)')", 'matches_pattern_unsupported', { feature: 'lookaround', at: 1 }],
  ["matches(self.stage, 'a{51}')", 'matches_pattern_too_big', { max: 1000 }],
];

describe('expression error codes (WP-421)', () => {
  for (const [src, code, params, env] of CORPUS) {
    it(`${src.slice(0, 40)} -> ${code}`, () => {
      const errors = found(src, env);
      const hit = errors.find((e) => e.code === code);
      expect(hit, JSON.stringify(errors)).toBeDefined();
      expect(hit?.params).toMatchObject(params);
    });
  }

  it('a type that is not the expected one reports result_type', () => {
    const errors = found('self.stage', ENV, { expect: T.bool });
    expect(errors).toEqual([
      { code: 'result_type', params: { expected: 'bool', actual: 'string' }, hint: undefined },
    ]);
  });

  it('an operator the language does not have, in a hand-built tree, reports op_unsupported', () => {
    const lit = (value: number): Expr => ({
      kind: 'literal',
      type: 'int',
      value,
      span: { start: 0, end: 1 },
    });
    const ast = { kind: 'binary', op: '^', left: lit(1), right: lit(2), span: { start: 0, end: 3 } };
    const r = check(ast as unknown as Expr, ENV);
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toEqual(['op_unsupported']);
  });

  it('the corpus reaches every code of the registry (a code nothing reports is dead)', () => {
    const reached = new Set<string>(CORPUS.map(([, code]) => code));
    reached.add('result_type');
    reached.add('parser_internal'); // reached by the total-parse spec, which forces an internal failure
    reached.add('op_unsupported'); // only a hand-built AST has an operator the parser would refuse
    // reachable once a system field has no SQL column (registry `sql: false`); today every one has
    if (SYSTEM_FIELDS.entries.every((f) => f.sql)) reached.add('field_not_in_sql');
    expect(EXPR_ERRORS.keys.filter((k) => !reached.has(k))).toEqual([]);
  });

  const everything = (): Found[] => [
    ...PARSE_ERR.flatMap(([src]) => found(src)),
    ...CHECK_ERR.flatMap(([src]) => found(src)),
    ...CHECK_DEVICE_ERR.flatMap(([src]) => found(src, DEVICE_ENV)),
    ...CHECK_EXPECT.flatMap(([src, ty]) => found(src, ENV, { expect: ty })),
    ...CORPUS.flatMap(([src, , , env]) => found(src, env)),
  ];

  it('every error has a registry code, only declared params and a declared hint variant', () => {
    const all = everything();
    expect(all.length).toBeGreaterThan(200);
    for (const e of all) {
      expect(e.code !== undefined && EXPR_ERRORS.has(e.code), JSON.stringify(e)).toBe(true);
      const entry = EXPR_ERRORS.get(e.code as ExprErrorCode);
      for (const [name, value] of Object.entries(e.params ?? {})) {
        if (name === 'hint_variant') {
          expect(entry.hints, JSON.stringify(e)).toContain(value);
        } else {
          expect(entry.params, `${e.code}: ${name}`).toContain(name);
          expect(['string', 'number']).toContain(typeof value);
        }
      }
      // a hint is worded from a declared variant, and a variant says there is a hint
      expect(e.hint !== undefined, JSON.stringify(e)).toBe(e.params?.['hint_variant'] !== undefined);
    }
  });

  it('property: arbitrary input yields only registry codes with flat params', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (src) => {
        for (const e of found(src)) {
          if (e.code === undefined || !EXPR_ERRORS.has(e.code)) return false;
          const flat = Object.values(e.params ?? {}).every(
            (v) => typeof v === 'string' || typeof v === 'number',
          );
          if (!flat) return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
