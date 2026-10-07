import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { TemplateFileSchema } from '../file';
import * as exprCompile from '../../expr/compile';
import { fromCql2, parse } from '../../expr/compile';
import { check } from '../../expr/check';
import { toSql } from '../../expr/sql';
import * as compileEntry from './index';
import { compile as compileWith, checkEnvFor, type CompiledConfig } from './index';
import { buildEnv, withVars } from './env';
import pkg from '../../../package.json';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const file = TemplateFileSchema.parse(parseYaml(Object.values(raw)[0] as string));
const result = compile(file);
if (!result.ok) throw new Error('fixture must compile');
const config: CompiledConfig = result.config;

describe('public entries for the server (OGC API)', () => {
  it('fromCql2 is on @ueberblick/core/expr/compile and checkEnvFor on @ueberblick/core/compile', () => {
    expect(pkg.exports['./expr/compile']).toBe('./src/expr/compile.ts');
    expect(pkg.exports['./compile']).toBe('./src/schema/compile/index.ts');
    expect(typeof exprCompile.fromCql2).toBe('function');
    expect(typeof compileEntry.checkEnvFor).toBe('function');
  });
});

describe('checkEnvFor', () => {
  it('returns the env compile uses for a type row filter (structurally equal, self is the type)', () => {
    const r = checkEnvFor(config, 'baum');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cenv = buildEnv(config.file);
    expect(r.env).toEqual(withVars(cenv, { self: cenv.feature('baum') }, false, true));
    expect(r.env.vars['self']).toEqual({ kind: 'feature', type: 'baum' });
  });

  it('refuses an unknown type with a typed error', () => {
    const r = checkEnvFor(config, 'gibt_es_nicht');
    expect(r).toEqual({ ok: false, error: { code: 'unknown_type', type: 'gibt_es_nicht' } });
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'refuses the inherited key %s as an unknown type',
    (key) => {
      const r = checkEnvFor(config, key);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('unknown_type');
    },
  );

  it('pipeline: fromCql2 -> check -> toSql on a golden type collection filter', () => {
    const r = checkEnvFor(config, 'baum');
    if (!r.ok) throw new Error('env');
    const ast = fromCql2("stage = 'erfasst' AND vitalitaet IN ('v3','v4')");
    if (!ast.ok) throw new Error(ast.errors[0]?.message);
    const checked = check(ast.ast, r.env, { expect: { kind: 'bool' } });
    if (!checked.ok) throw new Error(checked.errors[0]?.message);
    const sql = toSql(checked.typed, { self: 'f', vars: new Map() });
    expect(sql.ok).toBe(true);
    if (sql.ok) expect(sql.sql).toContain("json_extract(f.properties, '$.stage')");
  });

  it('the pipeline rejects a property the type does not declare', () => {
    const r = checkEnvFor(config, 'baum');
    if (!r.ok) throw new Error('env');
    const ast = fromCql2("nope = 'x'");
    if (!ast.ok) throw new Error('parse');
    expect(check(ast.ast, r.env, {}).ok).toBe(false);
  });

  it('CEL parse and CQL2 import share the entry', () => {
    expect(parse('1 == 1').ok).toBe(true);
  });
});
