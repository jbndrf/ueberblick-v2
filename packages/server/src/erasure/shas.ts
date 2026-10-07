import type { Json } from '@ueberblick/core';

/** Every `sha256` a stored value names, anywhere inside it (a `file` value is `{sha256, name, mime}`; a run input holds form values). */
export function collectShas(value: Json, out: Set<string>): void {
  if (Array.isArray(value)) for (const v of value) collectShas(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'sha256' && typeof v === 'string') out.add(v);
      else collectShas(v, out);
    }
  }
}
