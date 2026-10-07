/**
 * The selects of the Felder hub for what a drag cannot say (WP-378, WP-1057): a card sits left, right or full width, and move to another tab or into Ausgeblendet. They work on the lines of a tab
 * (`buildFieldHub`) and write the rows and columns back as the same `display` ops the drops use (`ops.ts`), so there
 * is one way to change a layout (R1). Pure: no DOM.
 */
import type { LocalizedString, PropertyDisplayColumn, TemplateFile } from '@ueberblick/core';
import type { Op } from '../../../doc';
import { HUB_DEFAULT_TAB, buildFieldHub, tabNameOf, type HubField } from './hub';
import { displayOp, dropOnTabOp, hideOp, nextRow } from './ops';

interface Cell {
  readonly key: string;
  column: PropertyDisplayColumn;
}

export interface Arrange {
  /** The tabs a card can go to: a Daten tab (`value` its name) or the library (`value: null`). */
  readonly tabs: readonly { readonly value: string | null; readonly label: string }[];
  readonly tab: string;
  oncolumn: (column: 'left' | 'right' | 'full') => void;
  ontab: (value: string | null) => void;
}

/** Where a card can go with the buttons: whether it can move up or down in its tab. */
export interface Reach {
  readonly up: boolean;
  readonly down: boolean;
}

function linesOf(file: TemplateFile, type: string, tab: string, locale: string): Cell[][] {
  const hub = buildFieldHub(file, type, locale);
  const lines = hub.tabs.find((t) => t.name === tab)?.lines ?? [];
  return lines.map((l) => l.map((f: HubField) => ({ key: f.key, column: f.column })));
}

/** The tab a visible property sits on (the default tab: `''`). */
function tabOf(file: TemplateFile, type: string, key: string, locale: string): string | undefined {
  const p = file.types?.[type]?.properties[key];
  return p === undefined || p.display?.hidden === true ? undefined : tabNameOf(p, locale);
}

/** The ops that write `lines` back: one `display` set per property whose row or column changed. */
function writeLines(file: TemplateFile, type: string, lines: readonly (readonly Cell[])[]): Op[] {
  const ops: Op[] = [];
  lines.forEach((line, row) => {
    for (const c of line) {
      const d = file.types?.[type]?.properties[c.key]?.display;
      const column = c.column === 'full' ? undefined : c.column;
      if (d?.row === row && d.column === column) continue;
      ops.push(displayOp(file, type, c.key, { row, column }));
    }
  });
  return ops;
}

function find(lines: Cell[][], key: string): { i: number; at: number } | undefined {
  for (let i = 0; i < lines.length; i += 1) {
    const at = (lines[i] ?? []).findIndex((c) => c.key === key);
    if (at >= 0) return { i, at };
  }
  return undefined;
}

export function reach(file: TemplateFile, type: string, key: string, locale: string): Reach {
  const tab = tabOf(file, type, key, locale);
  if (tab === undefined) return { up: false, down: false };
  const lines = linesOf(file, type, tab, locale);
  const at = find(lines, key);
  if (at === undefined) return { up: false, down: false };
  const shared = (lines[at.i]?.length ?? 0) > 1;
  return { up: shared || at.i > 0, down: shared || at.i < lines.length - 1 };
}

/** "Nach oben" / "Nach unten": a card alone in its line swaps with the neighbouring line; one in a pair steps out into its own line. */
export function moveLineOps(
  file: TemplateFile,
  type: string,
  key: string,
  delta: -1 | 1,
  locale: string,
): Op[] {
  const tab = tabOf(file, type, key, locale);
  if (tab === undefined) return [];
  const lines = linesOf(file, type, tab, locale);
  const at = find(lines, key);
  if (at === undefined) return [];
  const line = lines[at.i] as Cell[];
  if (line.length > 1) {
    const [cell] = line.splice(at.at, 1);
    lines.splice(delta === -1 ? at.i : at.i + 1, 0, [cell as Cell]);
  } else {
    const j = at.i + delta;
    if (j < 0 || j >= lines.length) return [];
    [lines[at.i], lines[j]] = [lines[j] as Cell[], line];
  }
  return writeLines(file, type, lines);
}

/**
 * "Links" / "Rechts" / "Volle Breite". A half-width card alone in its line joins the line above when that holds one
 * card (which takes the other half); "Volle Breite" takes a card out of a shared line into its own, below its partner.
 */
export function setColumnOps(
  file: TemplateFile,
  type: string,
  key: string,
  column: PropertyDisplayColumn,
  locale: string,
): Op[] {
  const tab = tabOf(file, type, key, locale);
  if (tab === undefined) return [];
  const lines = linesOf(file, type, tab, locale);
  const at = find(lines, key);
  if (at === undefined) return [];
  const line = lines[at.i] as Cell[];
  const cell = line[at.at] as Cell;
  cell.column = column;
  if (column === 'full') {
    if (line.length > 1) {
      line.splice(at.at, 1);
      lines.splice(at.i + 1, 0, [cell]);
    }
  } else if (line.length === 1 && at.i > 0 && (lines[at.i - 1]?.length ?? 0) === 1) {
    const partner = (lines[at.i - 1] as Cell[])[0] as Cell;
    partner.column = column === 'left' ? 'right' : 'left';
    lines.splice(at.i, 1);
    (lines[at.i - 1] as Cell[]).push(cell);
  }
  return writeLines(file, type, lines);
}

/**
 * A drop between the lines of Daten tab `tab` (the drag of the Daten pane, the same drop zones as the form editor):
 * the property becomes a line of its own before line `line` (`line` = the line count: at the end), in `tab`.
 */
export function placeAtLineOps(
  file: TemplateFile,
  type: string,
  key: string,
  tab: string,
  line: number,
  locale: string,
): Op[] {
  const before = linesOf(file, type, tab, locale);
  const lines = before.map((l) => l.filter((c) => c.key !== key)).filter((l) => l.length > 0);
  // `line` counts the lines as the user sees them, which still hold the moved card.
  const hole = before.slice(0, line).filter((l) => l.length > 0 && l.every((c) => c.key === key)).length;
  lines.splice(Math.max(0, Math.min(line - hole, lines.length)), 0, [{ key, column: 'full' }]);
  const [moved] = addToTabOps(file, type, key, tab, locale);
  const ops: Op[] = [];
  lines.forEach((l, row) => {
    for (const c of l) {
      if (c.key === key) {
        if (moved !== undefined) ops.push(withDisplay(moved, { row, column: undefined }));
        continue;
      }
      const d = file.types?.[type]?.properties[c.key]?.display;
      const column = c.column === 'full' ? undefined : c.column;
      if (d?.row === row && d.column === column) continue;
      ops.push(displayOp(file, type, c.key, { row, column }));
    }
  });
  return ops;
}

/** The Daten tabs of the Objektart's visible and hidden properties alike (`tab_order` of a tab: its smallest). */
function tabOrders(file: TemplateFile, type: string, locale: string): Map<string, number> {
  const orders = new Map<string, number>();
  for (const p of Object.values(file.types?.[type]?.properties ?? {})) {
    const name = tabNameOf(p, locale);
    if (name === HUB_DEFAULT_TAB) continue;
    orders.set(name, Math.min(orders.get(name) ?? Number.POSITIVE_INFINITY, p.display?.tab_order ?? 0));
  }
  return orders;
}

/** The op with `patch` merged into the `display` it sets (an op from `ops.ts` is one whole `display`). */
function withDisplay(op: Op, patch: Readonly<Record<string, unknown>>): Op {
  if (op.kind !== 'set') return op;
  const merged: Record<string, unknown> = { ...(op.value as object), ...patch };
  return { ...op, value: Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) };
}

/**
 * The property goes to the end of Daten tab `tab` (v3 `DataTabsSection`, "Felder zum aktiven Tab hinzufügen"). A tab
 * no property has yet is created after the others: its `tab_order` is the next one (v3 gave a new tab 9999).
 */
export function addToTabOps(
  file: TemplateFile,
  type: string,
  key: string,
  tab: string,
  locale: string,
): Op[] {
  const op = dropOnTabOp(file, type, key, tab, locale);
  if (tab === HUB_DEFAULT_TAB) return [withDisplay(op, { tab_order: undefined })];
  const orders = tabOrders(file, type, locale);
  const order = orders.get(tab) ?? Math.max(0, ...orders.values()) + 1;
  return [withDisplay(op, { tab_order: order })];
}

/** "Aus Tab entfernen": back to the default tab, as its last row (v3 reset the field's display config). */
export const removeFromTabOps = (file: TemplateFile, type: string, key: string, locale: string): Op[] =>
  addToTabOps(file, type, key, HUB_DEFAULT_TAB, locale);

/** "In Tab verschieben": `tab` is a Daten tab name (default `''`) or the library (`null`, Ausgeblendet). */
export function moveToTabOps(
  file: TemplateFile,
  type: string,
  key: string,
  tab: string | null,
  locale: string,
): Op[] {
  return tab === null ? [hideOp(file, type, key)] : addToTabOps(file, type, key, tab, locale);
}

/** The properties on a tab (hidden ones too): the visible ones in Daten order first. */
function onTab(file: TemplateFile, type: string, tab: string, locale: string): string[] {
  const shown = (buildFieldHub(file, type, locale).tabs.find((t) => t.name === tab)?.lines ?? [])
    .flat()
    .map((f) => f.key);
  const rest = Object.entries(file.types?.[type]?.properties ?? {})
    .filter(([k, p]) => tabNameOf(p, locale) === tab && !shown.includes(k))
    .map(([k]) => k);
  return [...shown, ...rest];
}

/** Rename tab `from` to `to`: every property of it takes the new name (an empty or taken name changes nothing). */
export function renameTabOps(
  file: TemplateFile,
  type: string,
  from: string,
  to: string,
  locale: string,
): Op[] {
  const name = to.trim();
  if (from === HUB_DEFAULT_TAB || name === '' || name === from || tabOrders(file, type, locale).has(name)) {
    return [];
  }
  return onTab(file, type, from, locale).map((key) => {
    const old = file.types?.[type]?.properties[key]?.display?.tab as LocalizedString | undefined;
    const tab = typeof old === 'object' ? { ...old, [locale]: name } : { [locale]: name };
    return displayOp(file, type, key, { tab });
  });
}

/**
 * Delete tab `tab`: its properties are left without a tab, the visible ones as new last rows of the default tab in the
 * order they had (v3 reset their display config), the hidden ones stay in the library.
 */
export function deleteTabOps(file: TemplateFile, type: string, tab: string, locale: string): Op[] {
  if (tab === HUB_DEFAULT_TAB) return [];
  let row = nextRow(file, type, HUB_DEFAULT_TAB, locale);
  return onTab(file, type, tab, locale).map((key) => {
    const clear = { tab: undefined, tab_order: undefined };
    return file.types?.[type]?.properties[key]?.display?.hidden === true
      ? displayOp(file, type, key, clear)
      : displayOp(file, type, key, { ...clear, row: row++, column: undefined });
  });
}

/** v3's checkbox "In Daten-Tabs ausgeblendet" (`display_config.invisible`): hide the property, or show it again where it was. */
export const setHiddenOp = (file: TemplateFile, type: string, key: string, hidden: boolean): Op =>
  displayOp(file, type, key, { hidden: hidden ? true : undefined });

/** A name for a new tab that no tab has: "Neuer Tab", "Neuer Tab 2", … (v3 `addTab`). */
export function newTabName(taken: readonly string[], base: string): string {
  let name = base;
  for (let n = 2; taken.includes(name); n += 1) name = `${base} ${n}`;
  return name;
}
