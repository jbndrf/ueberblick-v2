/**
 * Project files typed as text: an overlay (from the upgrade wizard).
 * One parse for the lens and the routes (R1): YAML, then the file schema; a message per problem.
 */
import { parse } from 'yaml';
import { OverlayFileSchema, type OverlayFile } from '@ueberblick/core';

export type ParsedSource<T> =
  { readonly ok: true; readonly file: T } | { readonly ok: false; readonly messages: readonly string[] };

const at = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '' : `${path.map(String).join('.')}: `;

function parseWith<T>(
  text: string,
  schema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
  },
): ParsedSource<T> {
  let value: unknown;
  try {
    value = parse(text);
  } catch (e) {
    return { ok: false, messages: [e instanceof Error ? e.message : 'The text is not valid YAML.'] };
  }
  const r = schema.safeParse(value);
  return r.success
    ? { ok: true, file: r.data }
    : { ok: false, messages: r.error.issues.map((i) => `${at(i.path)}${i.message}`) };
}

export const parseOverlaySource = (text: string): ParsedSource<OverlayFile> =>
  parseWith(text, OverlayFileSchema);
