/** One v3 stored value as a v4 property value. Text is NFC (v3 compared text NFC-normalised, v4 stores it so). */
import type { Json } from '@ueberblick/core';
import type { TypeMapping } from '../config/convert';
import { toV4 } from '../diffcheck/values';
import { toInstant } from './read';
import type { V3Value } from './types';

export type PropMap = TypeMapping['properties'][string];

const nfc = (s: string): string => s.normalize('NFC');

/** The value as v3 wrote it (JSON), with every text NFC; `undefined` for a shape v3 never wrote (an object). */
function v3Value(raw: unknown): V3Value | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return nfc(raw);
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (Array.isArray(raw) && raw.every((x): x is string => typeof x === 'string')) return raw.map(nfc);
  return undefined;
}

/**
 * `null` when v3 holds an empty value (the field was cleared), `undefined` when there is no v4 counterpart.
 * References are resolved by the caller, not here.
 */
export function convertValue(p: PropMap, raw: unknown): Json | undefined {
  const v = v3Value(raw);
  if (v === undefined) return undefined;
  const out = toV4(p, v);
  if (typeof out !== 'string') return out;
  if (p.type === 'date') {
    const day = /^\d{4}-\d{2}-\d{2}/.exec(out)?.[0];
    return day !== undefined && !Number.isNaN(Date.parse(day)) ? day : undefined;
  }
  if (p.type === 'datetime') return toInstant(out);
  return out;
}
