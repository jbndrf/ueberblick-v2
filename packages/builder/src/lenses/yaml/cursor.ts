/**
 * Where the cursor is in a YAML text, found from indentation alone. The text is being typed and
 * is usually not valid YAML, so a parser cannot be used; block style (the style of every golden
 * file) is what the lens completes. A flow map or a comment gives no context.
 */
import { ITEM } from './schema-path';

export const CURSOR_MODES = ['key', 'value', 'item'] as const;
export type CursorMode = (typeof CURSOR_MODES)[number];

export interface CursorContext {
  /** Keys from the top of the file to the map (or list) the cursor is in; `#item` is a list element. */
  readonly path: readonly string[];
  /** `key`: a key is being typed. `value`: the value after `key:`. `item`: after a list dash. */
  readonly mode: CursorMode;
  /** The word typed so far. */
  readonly prefix: string;
  /** Offset where the word starts (the completion replaces `from` to the cursor). */
  readonly from: number;
  /** Keys already present in the same map (above and below the cursor line). */
  readonly siblings: readonly string[];
  /** For `value` mode: the key the value belongs to. */
  readonly key?: string;
}

interface Line {
  /** Column of the dash of a list item, else -1. */
  readonly dash: number;
  /** Column where the content (the key) starts, after an optional dash. */
  readonly content: number;
  readonly key: string | undefined;
}

const KEY = /^(["']?)([^\s:#"'{}[\],][^:#]*?)\1:(?:\s|$)/;

function parseLine(l: string): Line | undefined {
  if (l.trim() === '' || l.trimStart().startsWith('#')) return undefined;
  const ind = l.length - l.trimStart().length;
  const dashed = /^-(\s+|$)/.exec(l.slice(ind));
  const content = ind + (dashed ? dashed[0].length : 0);
  const key = KEY.exec(l.slice(content))?.[2];
  return { dash: dashed ? ind : -1, content, key };
}

/** The keys of the map that starts at column `col`, around line `at`. */
function siblingsOf(lines: readonly Line[], at: number, col: number): string[] {
  const out: string[] = [];
  const scan = (dir: 1 | -1): void => {
    for (let i = at + dir; i >= 0 && i < lines.length; i += dir) {
      const l = lines[i] as Line;
      if (l.content < col) return;
      if (l.content === col && l.key !== undefined) out.push(l.key);
      if (l.dash >= 0 && l.dash < col && dir === -1) return; // the dash that opens this map
      if (l.dash >= 0 && l.dash < col && dir === 1) return; // the next item
    }
  };
  scan(-1);
  scan(1);
  return out;
}

export function cursorContext(text: string, pos: number): CursorContext | undefined {
  const before = text.slice(0, pos);
  const rows = text.split('\n');
  const lineNo = before.split('\n').length - 1;
  const upto = before.slice(before.lastIndexOf('\n') + 1);
  if (upto.trimStart().startsWith('#')) return undefined;
  if (/[{[]/.test(upto.replace(/"[^"]*"|'[^']*'/g, ''))) return undefined;

  const ind = upto.length - upto.trimStart().length;
  const dashed = /^-(\s+)/.exec(upto.slice(ind));
  const rest = upto.slice(ind + (dashed ? dashed[0].length : 0));
  const content = ind + (dashed ? dashed[0].length : 0);

  let mode: CursorMode;
  let prefix: string;
  let key: string | undefined;
  const value = /^(["']?)([^\s:#"'{}[\],][^:#]*?)\1:\s+(\S*)$/.exec(rest);
  if (value) {
    mode = 'value';
    key = value[2] as string;
    prefix = value[3] as string;
  } else if (/^["']?[^\s:#"'{}[\],]*$/.test(rest)) {
    mode = dashed ? 'item' : 'key';
    prefix = rest;
  } else return undefined;

  // The cursor line is not among the ancestors: only lines above it count.
  const above = rows.slice(0, lineNo).map(parseLine);
  const path: string[] = [];
  let t = mode === 'item' ? ind : content;
  for (let i = above.length - 1; i >= 0 && t > 0; i--) {
    const l = above[i];
    if (l === undefined) continue;
    if (l.content < t && l.key !== undefined) {
      path.unshift(l.key);
      t = l.content;
    }
    if (l.dash >= 0 && l.dash < t) {
      path.unshift(ITEM);
      t = l.dash;
    }
  }
  if (mode === 'item') path.push(ITEM);

  // Siblings: the cursor line takes part with its own indentation.
  const own: Line = { dash: dashed ? ind : -1, content, key: undefined };
  const withOwn = rows.map((r, i) => (i === lineNo ? own : parseLine(r)));
  const compact = withOwn.filter((l): l is Line => l !== undefined);
  const at = compact.indexOf(own);
  const siblings = mode === 'key' && !dashed ? siblingsOf(compact, at, content) : [];
  return {
    path,
    mode,
    prefix,
    from: pos - prefix.length,
    siblings,
    ...(key === undefined ? {} : { key }),
  };
}
