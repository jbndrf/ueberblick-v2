/**
 * A task's `when` as v3's task pane edits it (`TaskConfigSidebar.svelte:337-352`): a stage pin (the phase the task is
 * offered in) and the other conditions (the Bedingungen rows). Both are conjuncts of one rule-language expression
 * (R5): a stage pin is `self.<stage> == 'x'` (or `in [...]`). The roles are the task's `who`, not part of `when`
 * (C-004 step 3). Pure text in, text out: the parser is core's, nothing here defines what a condition means.
 *
 * Results: `false` means the condition cannot be edited this way (its top level is an `||`, it does not parse);
 * the pane then shows it as text instead of guessing.
 */
import { parse, type Expr } from '@ueberblick/core/expr/compile';
import { literalText } from '../../shell/conditions';

export interface Leaf {
  readonly src: string;
  readonly ast: Expr;
}

type Binary = Extract<Expr, { kind: 'binary' }>;
/** The node when it is a binary `op`; a value, not a type guard, so the else branch keeps the whole union. */
export const bin = (e: Expr, op: string): Binary | undefined =>
  e.kind === 'binary' && e.op === op ? e : undefined;
const isBinary = (e: Expr, op: string): boolean => bin(e, op) !== undefined;

/** The conjuncts of `source` in order; undefined when it does not parse. */
export function leavesOf(source: string | undefined): Leaf[] | undefined {
  if (source === undefined || source.trim() === '') return [];
  const parsed = parse(source);
  if (!parsed.ok) return undefined;
  const out: Leaf[] = [];
  const stack: Expr[] = [parsed.ast];
  while (stack.length > 0) {
    const e = stack.pop() as Expr;
    const and = bin(e, '&&');
    if (and !== undefined) stack.push(and.right, and.left);
    else out.push({ src: source.slice(e.span.start, e.span.end).trim(), ast: e });
  }
  return out;
}

/** True when `src` is wrapped in one pair of parentheses that match each other. */
function wrapped(src: string): boolean {
  if (!src.startsWith('(') || !src.endsWith(')')) return false;
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (quote !== undefined) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = undefined;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0 && i < src.length - 1) return false;
    }
  }
  return true;
}

const unwrap = (src: string): string => (wrapped(src) ? unwrap(src.slice(1, -1).trim()) : src);

/** `src` as one conjunct: an `||` or a `?:` at its top level needs parentheses next to an `&&`. */
function group(src: string): string {
  const bare = unwrap(src);
  const parsed = parse(bare);
  const loose = parsed.ok && (isBinary(parsed.ast, '||') || parsed.ast.kind === 'conditional');
  return loose ? `(${bare})` : bare;
}

export function compose(parts: readonly string[]): string | undefined {
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return unwrap(parts[0] as string);
  return parts.map(group).join(' && ');
}

const stringLiteral = (e: Expr): string | undefined =>
  e.kind === 'literal' && typeof e.value === 'string' ? e.value : undefined;
const isSelfProperty = (e: Expr, property: string): boolean =>
  e.kind === 'member' && e.field === property && e.object.kind === 'ident' && e.object.name === 'self';

/** The options a conjunct pins `self.<property>` to. */
function pin(ast: Expr, property: string): string[] | undefined {
  const eq = bin(ast, '==');
  const inn = bin(ast, 'in');
  if (eq !== undefined && isSelfProperty(eq.left, property)) {
    const v = stringLiteral(eq.right);
    return v === undefined ? undefined : [v];
  }
  if (inn !== undefined && isSelfProperty(inn.left, property) && inn.right.kind === 'list') {
    const vs = inn.right.elements.map(stringLiteral);
    return vs.every((v): v is string => v !== undefined) ? vs : undefined;
  }
  return undefined;
}

/** The whole condition is one `||`: a stage pin cannot be added to it as a conjunct. */
const topLevelOr = (leaves: readonly Leaf[]): boolean =>
  leaves.length === 1 && isBinary((leaves[0] as Leaf).ast, '||');

export type StageResult = { readonly ok: true; readonly options: readonly string[] } | { readonly ok: false };

/** The stage options the task is pinned to (empty: offered in every stage). */
export function stageOf(source: string | undefined, property: string): StageResult {
  const leaves = leavesOf(source);
  if (leaves === undefined || topLevelOr(leaves)) return { ok: false };
  for (const l of leaves) {
    const options = pin(l.ast, property);
    if (options !== undefined) return { ok: true, options };
  }
  return { ok: true, options: [] };
}

/** The condition pinned to `option` (undefined: unpinned). `false`: not editable (an `||` at the top level). */
export function withStage(
  source: string | undefined,
  property: string,
  option: string | undefined,
): string | undefined | false {
  const leaves = leavesOf(source);
  if (leaves === undefined || topLevelOr(leaves)) return false;
  const parts = leaves.map((l) => l.src);
  const at = leaves.findIndex((l) => pin(l.ast, property) !== undefined);
  const clause = option === undefined ? undefined : `self.${property} == ${literalText(option)}`;
  if (at < 0) return compose(clause === undefined ? parts : [clause, ...parts]);
  return compose(
    clause === undefined ? parts.filter((_, i) => i !== at) : parts.map((p, i) => (i === at ? clause : p)),
  );
}
