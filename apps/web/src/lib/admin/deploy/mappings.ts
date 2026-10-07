import type { ValueMapping } from '@ueberblick/server';
import { isRecord } from '../../server/handlers/http';

/** A mapping is `{ to: <key> }` or `{ discard: true }`; anything else is refused. */
export function parseMappings(v: unknown): Record<string, ValueMapping> | undefined {
  if (v === undefined) return {};
  if (!isRecord(v)) return undefined;
  const out: Record<string, ValueMapping> = {};
  for (const [path, m] of Object.entries(v)) {
    if (!isRecord(m)) return undefined;
    if (typeof m['to'] === 'string' && m['to'] !== '') out[path] = { to: m['to'] };
    else if (m['discard'] === true) out[path] = { discard: true };
    else return undefined;
  }
  return out;
}
