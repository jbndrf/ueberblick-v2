/**
 * The check environment for an expression that runs against one feature type: `self` is a feature of
 * that type, server-side (`device: false`). Built from the same `buildEnv`/`withVars` that `compile()`
 * uses for `visible_when` (R1), so the OGC API's collection filters type-check exactly like the file's own.
 */
import type { Env } from '../../expr/check';
import type { CompiledConfig } from './contract';
import { buildEnv, withVars, type CompileEnv } from './env';

/** The refusal for a type the config does not declare. */
export interface UnknownTypeError {
  readonly code: 'unknown_type';
  readonly type: string;
}

export type CheckEnvResult =
  { readonly ok: true; readonly env: Env } | { readonly ok: false; readonly error: UnknownTypeError };

const bases = new WeakMap<CompiledConfig, CompileEnv>();

/** The env for checking a row filter over `type` (pass it to `check(ast, env, { expect: T.bool })`). */
export function checkEnvFor(config: CompiledConfig, type: string): CheckEnvResult {
  if (!Object.hasOwn(config.file.types ?? {}, type))
    return { ok: false, error: { code: 'unknown_type', type } };
  let base = bases.get(config);
  if (!base) {
    base = buildEnv(config.file);
    bases.set(config, base);
  }
  return { ok: true, env: withVars(base, { self: base.feature(type) }, false, true) };
}
