/**
 * Chips as an editing model (docs/06 "toChips"). Core owns the meaning: `sqlApi.toChips` reads a
 * condition only when `fromChips` gives the same tree back (R5), so a chip list never changes what a
 * condition means. This module adds what an editor needs on top: chips to source text, one typed
 * value to a literal, and the add / remove / update steps that keep a chip list well formed
 * (compare chips separated by single joins). No DOM.
 */
import { sqlApi, type Chip, type ChipsResult, type Json } from '@ueberblick/core';
import { parse } from '@ueberblick/core/expr/compile';

export type CompareChip = Extract<Chip, { kind: 'compare' }>;
type Join = Extract<Chip, { kind: 'join' }>;

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

function quote(s: string): string {
  let out = "'";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    out += ESCAPES[ch] ?? (code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : ch);
  }
  return `${out}'`;
}

/** A value as rule-language source: strings in single quotes (the file's own style), lists in brackets. */
export function literalText(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(literalText).join(', ')}]`;
  if (typeof v === 'string') return quote(v);
  if (v === null || typeof v === 'object') return 'null';
  return String(v);
}

/** The condition a chip list says. Joins keep the language's precedence (`&&` binds tighter than `||`). */
export function chipsToSource(chips: readonly Chip[]): string {
  return chips.map((c) => (c.kind === 'join' ? c.op : `${c.left} ${c.op} ${literalText(c.right)}`)).join(' ');
}

/** Chips of a condition text, or the text itself when chips could not give back the same tree. */
export function chipsOfSource(source: string): ChipsResult {
  const parsed = parse(source);
  return parsed.ok ? sqlApi.toChips(parsed.ast) : { ok: false, text: source };
}

export type LiteralResult = { readonly ok: true; readonly value: Json } | { readonly ok: false };

/** A typed right-hand side (`'v3'`, `12`, `true`, `['a', 'b']`) as a value; core's parser decides what a literal is. */
export function parseLiteral(text: string): LiteralResult {
  const r = chipsOfSource(`self.x == ${text}`);
  const only = r.ok && r.chips.length === 1 ? r.chips[0] : undefined;
  return only?.kind === 'compare' ? { ok: true, value: only.right } : { ok: false };
}

const AND: Join = { kind: 'join', op: '&&' };

/** Appends `chip`, separated from the last chip by `&&`. */
export function appendChip(chips: readonly Chip[], chip: CompareChip): readonly Chip[] {
  return chips.length === 0 ? [chip] : [...chips, AND, chip];
}

/** Removes the compare chip at `index` and the join next to it, so the rest stays well formed. */
export function removeChip(chips: readonly Chip[], index: number): readonly Chip[] {
  if (chips[index]?.kind !== 'compare') return chips;
  const drop = index === 0 ? [0, 1] : [index - 1, index];
  return chips.filter((_, i) => !drop.includes(i));
}

/** Replaces the chip at `index` (a compare chip by a compare chip, a join by a join). */
export function updateChip(chips: readonly Chip[], index: number, chip: Chip): readonly Chip[] {
  const old = chips[index];
  if (old === undefined || old.kind !== chip.kind) return chips;
  return chips.map((c, i) => (i === index ? chip : c));
}
