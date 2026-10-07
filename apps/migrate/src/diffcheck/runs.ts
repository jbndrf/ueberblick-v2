/** Reads recorded v3 runs (already parsed from YAML or JSON) and checks their shape, so a bad export fails with a clear message. */
import { RECORDED_OUTCOMES } from './registry';
import type { V3Run } from './types';

export class RunsError extends Error {}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isValue = (x: unknown): boolean =>
  x === null ||
  ['string', 'number', 'boolean'].includes(typeof x) ||
  (Array.isArray(x) && x.every((i) => typeof i === 'string'));

function values(x: unknown, at: string): void {
  if (x === undefined) return;
  if (!isRec(x)) throw new RunsError(`${at} must be a map of field keys to values`);
  for (const [k, v] of Object.entries(x))
    if (!isValue(v)) throw new RunsError(`${at}.${k} is not a stored value`);
}

/** The runs of a parsed file: a list of runs (see `V3Run`). Throws `RunsError` on the first problem. */
export function parseRuns(input: unknown): V3Run[] {
  if (!Array.isArray(input)) throw new RunsError('runs must be a list');
  const ids = new Set<string>();
  input.forEach((r: unknown, i) => {
    const at = `runs[${i}]`;
    if (!isRec(r)) throw new RunsError(`${at} must be a map`);
    for (const k of ['id', 'workflow', 'task']) {
      if (typeof r[k] !== 'string' || r[k] === '')
        throw new RunsError(`${at}.${k} must be a non-empty string`);
    }
    const id = r['id'] as string;
    if (ids.has(id)) throw new RunsError(`${at}.id "${id}" is used twice`);
    ids.add(id);
    const actor = r['actor'];
    if (!isRec(actor) || typeof actor['id'] !== 'string' || !Array.isArray(actor['roles'])) {
      throw new RunsError(`${at}.actor needs an id and a list of roles`);
    }
    const rec = r['recorded'];
    if (!isRec(rec) || !RECORDED_OUTCOMES.has(String(rec['outcome']))) {
      throw new RunsError(`${at}.recorded.outcome must be one of ${RECORDED_OUTCOMES.keys.join(', ')}`);
    }
    values(r['input'], `${at}.input`);
    values(rec['values'], `${at}.recorded.values`);
    const inst = r['instance'];
    if (inst !== undefined) {
      if (!isRec(inst) || typeof inst['stage'] !== 'string')
        throw new RunsError(`${at}.instance needs a stage`);
      values(inst['values'], `${at}.instance.values`);
    }
  });
  return input as V3Run[];
}
