/**
 * The layout of one form as the editor edits it (v3 `FormPreview.svelte`: pages, rows, `column_position`):
 * pages, the lines of a page, the cells of a line. Pure, no DOM, no Doc: `ops.ts` turns the difference
 * between two layouts into document ops, the preview, the buttons and an assistant (H4) all call these
 * functions (R1).
 *
 * The file's form is flat. Its order is the order of the keys, a field that carries `page` starts a page, and a
 * property's `display.column` and `display.row` say where it sits in its line (the renderer's rule,
 * `@ueberblick/ui` `formLines`: neighbours with the same row share a line). `layoutOf` reads exactly that.
 */
import type { Json, PropertyDisplayColumn } from '@ueberblick/core';
import { formLines } from '@ueberblick/ui';

export type Column = PropertyDisplayColumn;
/** The `page` object of the field that starts a page (`label`, `hint`); `undefined` on the first page when it has none. */
export type PageMeta = { readonly [k: string]: Json } | undefined;

export interface Cell {
  readonly key: string;
  readonly column: Column;
}
export type Line = readonly Cell[];
export interface Page {
  readonly meta: PageMeta;
  readonly lines: readonly Line[];
}
export interface Layout {
  readonly pages: readonly Page[];
}

/** One entry of the file's form with what the layout needs from it. */
export interface Placed {
  readonly key: string;
  readonly column?: Column | undefined;
  readonly row?: number | undefined;
  readonly page?: { readonly [k: string]: Json } | undefined;
}

export function layoutOf(entries: readonly Placed[]): Layout {
  const groups: { meta: PageMeta; cells: Placed[] }[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last === undefined || e.page !== undefined) groups.push({ meta: e.page, cells: [e] });
    else last.cells.push(e);
  }
  return {
    pages: groups.map((g) => ({
      meta: g.meta,
      lines: formLines(g.cells).map((line) => line.map((c) => ({ key: c.key, column: c.column ?? 'full' }))),
    })),
  };
}

export const keysOf = (layout: Layout): string[] =>
  layout.pages.flatMap((p) => p.lines.flatMap((l) => l.map((c) => c.key)));

export function find(layout: Layout, key: string): { page: number; line: number; cell: number } | undefined {
  for (const [page, p] of layout.pages.entries())
    for (const [line, l] of p.lines.entries()) {
      const cell = l.findIndex((c) => c.key === key);
      if (cell >= 0) return { page, line, cell };
    }
  return undefined;
}

type Loose = { meta: PageMeta; lines: Cell[][] };
const open = (layout: Layout): Loose[] =>
  layout.pages.map((p) => ({ meta: p.meta, lines: p.lines.map((l) => [...l]) }));

/** Empty lines and pages go; every later page keeps `{}` at least, because it starts with a marker. */
function close(pages: readonly Loose[]): Layout {
  const kept = pages
    .map((p) => ({ meta: p.meta, lines: p.lines.filter((l) => l.length > 0) }))
    .filter((p) => p.lines.length > 0);
  return { pages: kept.map((p, i) => ({ meta: i === 0 ? p.meta : (p.meta ?? {}), lines: p.lines })) };
}

/** A pair is left then right (v3 `positionOrder`). */
const ordered = (line: Cell[]): Cell[] =>
  line.length === 2 && line[0]?.column === 'right' && line[1]?.column === 'left' ? [line[1], line[0]] : line;

/** Where a cell goes. `line` is an index into the layout as the user sees it, which still holds the moved cell. */
export type Dest =
  /** A new line of its own before line `line` (`line` = the page's line count: at the end). */
  | { readonly kind: 'line'; readonly page: number; readonly line: number; readonly column: Column }
  /** The empty side of a line that holds one half-width cell. */
  | { readonly kind: 'side'; readonly page: number; readonly line: number; readonly column: 'left' | 'right' }
  /** Beside a single cell: it becomes the other half, the moved cell takes `column` (v3 "squeeze"). */
  | { readonly kind: 'beside'; readonly key: string; readonly column: 'left' | 'right' }
  /** The end of a page, a line of its own. */
  | { readonly kind: 'page'; readonly page: number };

const other = (c: 'left' | 'right'): 'left' | 'right' => (c === 'left' ? 'right' : 'left');

/**
 * Puts `key` at `dest`: a new cell when `key` is not in the layout yet (a palette drop), else a move. The
 * moved cell leaves a hole while the destination is resolved, so the indices of `dest` stay valid.
 */
export function place(layout: Layout, key: string, dest: Dest): Layout {
  const pages = open(layout);
  for (const p of pages)
    for (const l of p.lines) {
      const at = l.findIndex((c) => c.key === key);
      if (at >= 0) l.splice(at, 1);
    }
  if (dest.kind === 'beside') {
    for (const p of pages)
      for (const l of p.lines) {
        const at = l.findIndex((c) => c.key === dest.key);
        if (at < 0 || l.length !== 1) continue;
        l.splice(0, 1, { key: dest.key, column: other(dest.column) });
        l.push({ key, column: dest.column });
        l.splice(0, l.length, ...ordered(l));
        return close(pages);
      }
    return layout;
  }
  // a page past the end is a new one (the pending page of the editor)
  if (dest.kind !== 'side')
    while (pages.length <= dest.page) pages.push({ meta: pages.length === 0 ? undefined : {}, lines: [] });
  const page = pages[dest.page];
  if (dest.kind === 'page') {
    page?.lines.push([{ key, column: 'full' }]);
  } else if (dest.kind === 'line') {
    page?.lines.splice(Math.min(dest.line, page.lines.length), 0, [{ key, column: dest.column }]);
  } else {
    const line = page?.lines[dest.line];
    const held = line?.[0];
    if (line === undefined || line.length !== 1 || held === undefined || held.column !== other(dest.column))
      return layout;
    line.push({ key, column: dest.column });
    line.splice(0, line.length, ...ordered(line));
  }
  return close(pages);
}

/** The key leaves the form; its page goes with it when it was the page's last field. */
export function remove(layout: Layout, key: string): Layout {
  const pages = open(layout);
  for (const p of pages)
    for (const l of p.lines) {
      const at = l.findIndex((c) => c.key === key);
      if (at >= 0) l.splice(at, 1);
    }
  return close(pages);
}

/** Width of one cell: `full`, or half on `left` / `right`. A half-width cell shares its line with nobody until another is placed beside it. */
export function setColumn(layout: Layout, key: string, column: Column): Layout {
  const at = find(layout, key);
  if (at === undefined) return layout;
  const pages = open(layout);
  const line = (pages[at.page] as Loose).lines[at.line] as Cell[];
  const mine = line[at.cell] as Cell;
  if (mine.column === column && line.length === 1) return layout;
  if (line.length === 1) {
    line[0] = { key, column };
  } else if (column === 'full') {
    // leaves the pair: its own line below, the partner stays above (order of the keys is kept)
    const rest = line.filter((c) => c.key !== key);
    const pageLines = (pages[at.page] as Loose).lines;
    const head = at.cell === 0;
    pageLines.splice(at.line, 1, ...(head ? [[{ key, column }], rest] : [rest, [{ key, column }]]));
  } else {
    const swapped = line.map((c) =>
      c.key === key ? { key, column } : { key: c.key, column: other(column) },
    );
    line.splice(0, line.length, ...ordered(swapped));
  }
  return close(pages);
}

/**
 * One step up (-1) or down (+1), the accessible way to reorder. A cell in a pair first leaves it (a line of
 * its own on the side it moves to); a single cell passes the line above or below; at the edge of a page it
 * continues into the neighbouring page.
 */
export function step(layout: Layout, key: string, by: -1 | 1): Layout {
  const at = find(layout, key);
  if (at === undefined) return layout;
  const pages = open(layout);
  const p = pages[at.page] as Loose;
  const line = p.lines[at.line] as Cell[];
  const mine = line[at.cell] as Cell;
  if (line.length > 1) {
    const rest = line.filter((c) => c.key !== key);
    p.lines.splice(at.line, 1, ...(by < 0 ? [[mine], rest] : [rest, [mine]]));
    return close(pages);
  }
  const target = at.line + by;
  if (target >= 0 && target < p.lines.length) {
    [p.lines[at.line], p.lines[target]] = [p.lines[target] as Cell[], line];
    return close(pages);
  }
  const next = pages[at.page + by];
  if (next === undefined) return layout;
  p.lines.splice(at.line, 1);
  next.lines.splice(by < 0 ? next.lines.length : 0, 0, [mine]);
  return close(pages);
}

/**
 * Takes a page out: its fields join the page before it (the first page joins the page after it, which then
 * keeps its own title). v3 deleted a page tab without touching the fields; none is lost here either.
 */
export function deletePage(layout: Layout, index: number): Layout {
  const pages = open(layout);
  const gone = pages[index];
  if (gone === undefined || pages.length < 2) return layout;
  if (index > 0) {
    (pages[index - 1] as Loose).lines.push(...gone.lines);
    pages.splice(index, 1);
  } else {
    const next = pages[1] as Loose;
    next.lines.unshift(...gone.lines);
    pages.splice(0, 1);
  }
  return close(pages);
}

/** The title or description of a page: `meta` replaces the page's marker object. */
export function setPageMeta(layout: Layout, index: number, meta: PageMeta): Layout {
  if (layout.pages[index] === undefined) return layout;
  return { pages: layout.pages.map((p, i) => (i === index ? { ...p, meta } : p)) };
}

/** Starts a new page at `key`: it and the fields after it on the same page move to a page of their own. */
export function startPageAt(layout: Layout, key: string): Layout {
  const at = find(layout, key);
  if (at === undefined) return layout;
  const pages = open(layout);
  const p = pages[at.page] as Loose;
  if (at.line === 0 && at.cell === 0) return layout;
  const line = p.lines[at.line] as Cell[];
  const tail = p.lines.splice(at.line + 1);
  const head = line.slice(0, at.cell);
  const mine = line.slice(at.cell);
  p.lines.splice(at.line, 1, ...(head.length > 0 ? [head] : []));
  pages.splice(at.page + 1, 0, { meta: {}, lines: [mine, ...tail] });
  return close(pages);
}

/** The field no longer starts a page: the page joins the one before it. */
export function joinPageAt(layout: Layout, key: string): Layout {
  const at = find(layout, key);
  if (at === undefined || at.page === 0 || at.line !== 0 || at.cell !== 0) return layout;
  return deletePage(layout, at.page);
}

/**
 * The row each cell gets so the participant's form groups the lines as this layout does: a line with a pair
 * or a half-width cell shares one row, which differs from its neighbours'; a single full-width cell keeps
 * its row unless a neighbour has the same one (then it has none, and is a line of its own). `existing` is the
 * row the property has now.
 */
export function rowsOf(
  layout: Layout,
  existing: (key: string) => number | undefined,
): Map<string, number | undefined> {
  const out = new Map<string, number | undefined>();
  for (const p of layout.pages) {
    let previous: number | undefined;
    for (const [at, line] of p.lines.entries()) {
      const rows = line.map((c) => existing(c.key));
      const shared = rows[0] !== undefined && rows.every((r) => r === rows[0]) ? rows[0] : undefined;
      const single = line.length === 1 && line[0]?.column === 'full';
      let row: number | undefined;
      if (single) {
        row = rows[0] !== undefined && rows[0] === previous ? undefined : rows[0];
      } else {
        row = shared !== undefined && shared !== previous ? shared : at;
        while (row === previous) row += 0.5;
      }
      for (const c of line) out.set(c.key, row);
      previous = row;
    }
  }
  return out;
}
