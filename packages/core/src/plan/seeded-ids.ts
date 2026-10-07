/**
 * Ids for what a plan creates (a feature made by a task or rule, the id of a rule run), derived from the
 * submitted run's id and a per-kind counter. Planning the same run again (rebase, re-derivation, restart) mints
 * the same ids, so a queued run that refers to a rule-created feature stays valid and a re-plan never leaves a
 * ghost twin. No clock, no randomness (R2): the hash is a fixed 128-bit mixer, the shape is a UUID (version 7
 * nibble, RFC variant) so the server's schema accepts it.
 */
import type { FeatureId, RunId } from '../model';
import type { Ids } from '../ports';

/** cyrb128: four 32-bit words from a string. */
function hash128(text: string): readonly [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function uuid(text: string): string {
  const hex = hash128(text)
    .map((w) => w.toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex.charAt(16), 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A fresh sequence per plan call: the n-th feature id and the n-th run id of a plan of `seed`. */
export function seededIds(seed: RunId): Ids {
  let features = 0;
  let runs = 0;
  return {
    featureId: () => uuid(`${seed}|feature|${features++}`) as FeatureId,
    runId: () => uuid(`${seed}|run|${runs++}`) as RunId,
  };
}
