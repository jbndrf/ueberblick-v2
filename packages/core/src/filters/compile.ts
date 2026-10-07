/**
 * Parses and type-checks filters (WP-640). A filter is one rule-language expression per feature type, over `self`
 * (R5). Role presets (`roles.<r>.app.filter_presets`) and a participant's saved filters (`prefs`) have this one shape.
 * Presets are checked with the file (`checkFilterPresets`, paths into the file); a saved filter is checked when it
 * is used (`compileFilter`, paths `filters.<type>`).
 */
import { check, T } from '../expr/check';
import { parse } from '../expr/parse';
import type { TypedAst } from '../expr/check/check';
import type { Key } from '../model';
import { buildEnv, withVars, type CompileEnv } from '../schema/compile/env';
import type { CompiledConfig, Problem } from '../schema/compile/contract';
import { parseProblemHint, parseProblemParams, typeProblemParams } from '../schema/compile/expr-problems';
import { kp } from '../schema/compile/kp';
import type { TemplateFile } from '../schema/file';
import type { CompiledFilter, FilterCompileResult, FilterSource } from './contract';

/** Checks one expression over `self` of `type`; the problems carry `path`. */
function checkOne(
  base: CompileEnv,
  path: string,
  type: string,
  source: string,
): { readonly typed: TypedAst } | { readonly problems: readonly Problem[] } {
  if (!Object.hasOwn(base.env.features, type)) {
    const known = Object.keys(base.env.features).filter((t) => !t.startsWith('$'));
    return {
      problems: [
        {
          path,
          code: 'dangling_reference',
          message: `'${type}' is not a known feature type`,
          hint: known.length > 0 ? `use one of: ${known.join(', ')}` : 'declare the feature type first',
          params: {
            value: type,
            what: 'feature_type',
            existing: known.join(', '),
            ...(known.length > 0 ? {} : { variant: 'declare_first' }),
          },
        },
      ],
    };
  }
  const p = parse(source);
  if (!p.ok) {
    return {
      problems: p.errors.map((e) => ({
        path,
        code: 'expression_parse' as const,
        message: e.message,
        hint: parseProblemHint(source, e),
        params: parseProblemParams(source, e),
        span: e.span,
      })),
    };
  }
  // A filter runs on the device (it filters what the device holds), so it uses device-evaluable functions only.
  const env = withVars(base, { self: base.feature(type) }, true);
  const r = check(p.ast, env, { expect: T.bool });
  if (r.ok) return { typed: r.typed };
  return {
    problems: r.errors.map((e) => ({
      path,
      code: 'expression_type' as const,
      message: e.message,
      hint: e.hint ?? `change \`${source}\` so that it type-checks`,
      params: typeProblemParams(source, e),
      span: e.span,
    })),
  };
}

const bases = new WeakMap<TemplateFile, CompileEnv>();
const baseOf = (file: TemplateFile): CompileEnv => {
  let b = bases.get(file);
  if (b === undefined) {
    b = buildEnv(file);
    bases.set(file, b);
  }
  return b;
};

/** Compiles a filter against a compiled config: one checked predicate per type, or every problem found. */
export function compileFilter(config: CompiledConfig, filters: FilterSource): FilterCompileResult {
  const base = baseOf(config.file);
  const predicates = new Map<Key, TypedAst>();
  const problems: Problem[] = [];
  for (const [type, source] of Object.entries(filters)) {
    const r = checkOne(base, kp('filters', type), type, source);
    if ('typed' in r) predicates.set(type as Key, r.typed);
    else problems.push(...r.problems);
  }
  if (problems.length > 0) return { ok: false, problems };
  const filter: CompiledFilter = { predicates };
  return { ok: true, filter };
}

/** Every problem in the file's role presets, addressed by `roles.<r>.app.filter_presets.<k>.filters.<type>`. */
export function checkFilterPresets(file: TemplateFile): readonly Problem[] {
  const base = baseOf(file);
  const out: Problem[] = [];
  for (const [role, def] of Object.entries(file.roles ?? {})) {
    for (const [pk, preset] of Object.entries(def.app?.filter_presets ?? {})) {
      for (const [type, source] of Object.entries(preset.filters)) {
        const path = kp('roles', role, 'app', 'filter_presets', pk, 'filters', type);
        const r = checkOne(base, path, type, source);
        if ('problems' in r) out.push(...r.problems);
      }
    }
  }
  return out;
}
