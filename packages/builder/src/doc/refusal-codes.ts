/**
 * Why the doc refused an edit (WP-518): the one list of reasons (R6). `Refusal.code` is one of these; the shell
 * words each in the admin's language (`builder_refusal_<code>`, de + en), so the engine's English `message`
 * never has to reach the screen.
 */
export const REFUSAL_CODES = [
  'bad_path',
  'scalar_above',
  'schema',
  'dead_entry',
  'not_in_effective',
  'still_in_effective',
  'overlay_unreadable',
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

export const isRefusalCode = (code: string): code is RefusalCode =>
  (REFUSAL_CODES as readonly string[]).includes(code);
