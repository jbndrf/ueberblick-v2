/** v3 keys and labels become v4 keys (`^[a-z][a-z0-9_]*$`, never renamed) and stay unique per namespace. */

const GERMAN: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

const RESERVED: readonly string[] = [
  'self',
  'form',
  'value',
  'actor',
  'inputs',
  'other',
  'now',
  'true',
  'false',
  'null',
  'in',
];

/** Lowercase ASCII words joined by `_`. `lead` is put in front when the result does not start with a letter. */
export function slug(input: string, lead = 'k'): string {
  const ascii = input
    .replace(/[\u00e4\u00f6\u00fc\u00df\u00c4\u00d6\u00dc]/g, (c) => GERMAN[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const s = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s === '') return `${lead}_x`;
  return /^[a-z]/.test(s) ? s : `${lead}${s}`;
}

/** Hands out keys that are unique within one namespace, and never a reserved word. */
export class KeySpace {
  private readonly used = new Set<string>();

  constructor(reserved: readonly string[] = []) {
    for (const r of reserved) this.used.add(r);
  }

  /** The key for `preferred`; a suffix `_2`, `_3` … resolves a clash. */
  take(preferred: string, lead = 'k'): string {
    const base = slug(preferred, lead);
    let key = RESERVED.includes(base) ? `${base}_1` : base;
    for (let n = 2; this.used.has(key); n++) key = `${base}_${n}`;
    this.used.add(key);
    return key;
  }

  has(key: string): boolean {
    return this.used.has(key);
  }
}
