/** The function registry: every rule-language function, defined once (R1). */
import type { FunctionSig } from '../check/types';
import type { FunctionDef } from './define';
import { HISTORY_FUNCTION_DEFS } from './history';
import { SPATIAL_FUNCTIONS } from './spatial';
import { NUMBER_FUNCTIONS } from './numbers';
import { TEXT_FUNCTIONS } from './text';
import { TIME_FUNCTIONS } from './time';

export { defineFunction } from './define';
export type { FunctionCall, FunctionDef, FunctionEnv, FunctionSql, SqlArg, SqlCall } from './define';
export { fail } from './support';
export { HISTORY_FUNCTION_DEFS, HISTORY_FUNCTIONS } from './history';

export const FUNCTION_LIST: readonly FunctionDef[] = [
  ...SPATIAL_FUNCTIONS,
  ...TIME_FUNCTIONS,
  ...HISTORY_FUNCTION_DEFS,
  ...TEXT_FUNCTIONS,
  ...NUMBER_FUNCTIONS,
];

/** Functions by name. */
export const FUNCTIONS: ReadonlyMap<string, FunctionDef> = new Map(FUNCTION_LIST.map((f) => [f.name, f]));

if (FUNCTIONS.size !== FUNCTION_LIST.length) throw new Error('duplicate function name in the registry');

/** Signatures for `check`, derived from the registry; history functions are checked specially. */
export function functionSignatures(): Readonly<Record<string, readonly FunctionSig[]>> {
  const out: Record<string, readonly FunctionSig[]> = {};
  for (const f of FUNCTION_LIST) if (f.sigs.length > 0) out[f.name] = f.sigs;
  return out;
}
