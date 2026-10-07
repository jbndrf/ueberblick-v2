/** v3 stored values to v4 property values, through the conversion mapping (the same map WP-301 uses for data). */
import type { Json } from '@ueberblick/core';
import type { TypeMapping } from '../config/convert';
import type { V3Value } from './types';

type PropMap = TypeMapping['properties'][string];

/** The v4 value, `null` when v3 holds an empty value, or `undefined` when there is no counterpart. */
export function toV4(p: PropMap, v: V3Value): Json | undefined {
  if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
  const list = (): string[] | undefined => {
    if (Array.isArray(v)) return [...v];
    if (typeof v === 'string' && v.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return undefined;
      }
    }
    return typeof v === 'string' ? [v] : undefined;
  };
  switch (p.type) {
    case 'select': {
      const key = p.options?.[String(v)];
      return key;
    }
    case 'multiselect': {
      const items = list();
      if (items === undefined) return undefined;
      const keys = items.map((i) => p.options?.[i]);
      return keys.every((k): k is string => k !== undefined) ? keys : undefined;
    }
    case 'number':
    case 'integer': {
      const n = typeof v === 'number' ? v : Number(v);
      return typeof v !== 'boolean' && Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      return v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined;
    case 'reference':
    case 'geometry':
    case 'file':
      return undefined;
    default:
      return Array.isArray(v) ? undefined : String(v);
  }
}

/** Two values are equal as stored values (order of a list counts as irrelevant). */
export function sameValue(a: Json | undefined, b: Json | undefined): boolean {
  const empty = (v: Json | undefined): Json =>
    v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ? null : (v as Json);
  const x = empty(a);
  const y = empty(b);
  if (Array.isArray(x) && Array.isArray(y)) {
    return (
      x.length === y.length &&
      [...x].map(String).sort().join('\u0000') === [...y].map(String).sort().join('\u0000')
    );
  }
  return JSON.stringify(x) === JSON.stringify(y);
}

export const show = (v: Json | V3Value | undefined): string =>
  v === undefined ? 'nothing' : JSON.stringify(v);
