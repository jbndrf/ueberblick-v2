/**
 * Scope fingerprint: a pure, non-cryptographic 128-bit hash (cyrb128) over the sorted inputs.
 * It detects scope change, it does not authenticate. Inputs are length-prefixed so that
 * ["ab","c"] and ["a","bc"] differ.
 */
export function scopeFingerprint(inputs: readonly string[]): string {
  const sorted = [...inputs].sort();
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      const k = s.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
  };
  feed(`${sorted.length}:`);
  for (const s of sorted) feed(`${s.length}:${s}`);
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1 ^ h2 ^ h3 ^ h4) + hex(h2 ^ h1) + hex(h3 ^ h1) + hex(h4 ^ h1);
}
