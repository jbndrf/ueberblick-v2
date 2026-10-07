/** The value check `$seed` and `$import` share (R1): a value written to a declared property must fit it. */
import { isEmptyValue } from '../form/empty';
import { typeFits } from '../form/type';
import type { Json, Refusal } from '../model';
import type { CompiledConfig } from '../schema/compile/contract';
import { SYSTEM_FIELD_SIGIL } from '../registry/system-fields';
import { refuse } from './scope';

export type TypeDecl = NonNullable<CompiledConfig['file']['types']>[string];

/**
 * Refuses (`invalid_input`) a key that is no property of the type, a system key, or a non-empty value that does not
 * fit its property. An empty value passes: the caller leaves it out.
 */
export function valueRefusal(
  declared: TypeDecl,
  typeKey: string,
  key: string,
  value: Json,
  path: string,
): Refusal | undefined {
  if (key.startsWith(SYSTEM_FIELD_SIGIL))
    return refuse('invalid_input', `'${key}' is a system key; it cannot be written here`, path);
  const p = declared.properties[key];
  if (p === undefined) return refuse('invalid_input', `'${key}' is not a property of ${typeKey}`, path);
  if (!isEmptyValue(value) && !typeFits(p, value))
    return refuse('invalid_input', `'${key}' does not fit its ${p.type} property`, path);
  return undefined;
}
