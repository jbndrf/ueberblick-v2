/**
 * Type signatures of the built-in functions, derived from the function registry (R1): there is no
 * second table. History functions are checked specially (they name a property of `self`), see check.ts.
 */
import { functionSignatures } from '../functions';

export const BUILTIN_FUNCTIONS = functionSignatures();

/** Device stores keep only this many values per property. */
export const DEVICE_HISTORY_LIMIT = 10;
export { HISTORY_FUNCTIONS } from '../functions';
