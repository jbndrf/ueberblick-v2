import { isEmptyValue, sameJson } from '@ueberblick/core/form';
import type { Key } from '@ueberblick/core/model';
import type { Json } from '@ueberblick/ui';

/**
 * The form of a quick edit: one entry per picked property. A task form names the tool of a file property (`foto: { tool:
 * photo }`); a quick edit has no form entry, so a file property gets the photo tool here. Without it the field has no
 * tool to mount and "Loading the input" never ends (WP-1068).
 */
export function quickEditForm(
  picked: readonly Key[],
  properties: Readonly<Record<string, { readonly type: string }>>,
): Record<string, { tool?: string }> {
  return Object.fromEntries(picked.map((k) => [k, properties[k]?.type === 'file' ? { tool: 'photo' } : {}]));
}

/**
 * The input of a quick edit's run: only the picked properties the participant changed (v3 `editValues` holds only what
 * was touched, detail module :967-1010). An emptied value is an explicit null, which clears the property (v3 dropped
 * empty values, so a stored value could never be cleared); a value equal to the one now stored writes nothing.
 */
export function quickEditInput(
  picked: readonly Key[],
  current: Readonly<Record<string, Json>>,
  edited: Readonly<Record<string, Json>>,
): Record<string, Json> {
  const input: Record<string, Json> = {};
  for (const key of picked) {
    if (!Object.hasOwn(edited, key)) continue;
    const value = edited[key] as Json;
    if (sameJson(value, current[key])) continue;
    input[key] = isEmptyValue(value) ? null : value;
  }
  return input;
}
