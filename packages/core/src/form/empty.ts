/**
 * The one definition of "no value" (R1): form `required` and plan's create-time `required` both use it.
 * Empty: absent, null, an empty string, an empty list, and an object whose values are all empty
 * (an empty LocalizedString `{}` or `{ de: '' }`). A geometry or file object always carries a non-empty value.
 */
import type { Json } from '../model';

export function isEmptyValue(v: Json | undefined): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v).every((x) => isEmptyValue(x));
  return false;
}
