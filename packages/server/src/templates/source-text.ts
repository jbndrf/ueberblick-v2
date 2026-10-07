/**
 * Project files typed as text (YAML, which also reads JSON): the one read of a template or overlay text on the
 * server (R1). The shape check is the caller's, with the core file schemas.
 */
import { parse } from 'yaml';

export type ParsedText =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

/** `fallback` is the message when the parser throws something that is not an `Error`; each caller keeps its own wording. */
export function parseSourceText(text: string, fallback = 'The text is not YAML.'): ParsedText {
  try {
    return { ok: true, value: parse(text) as unknown };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : fallback };
  }
}
