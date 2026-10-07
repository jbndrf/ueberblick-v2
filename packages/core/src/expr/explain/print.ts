/**
 * AST → source text (for `explain` sentences and builder chips). Adds parentheses only where the grammar
 * needs them. A flat left-associative chain (`a || b || ...`, up to about 16k terms) is written with a loop,
 * never by recursion; only real nesting recurses, and the parser bounds that.
 */
import type { BinaryNode, Expr } from '../ast';

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  in: 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
};
const UNARY = 6;
const POSTFIX = 8;

const prec = (e: Expr): number => {
  switch (e.kind) {
    case 'binary':
      return BINARY_PRECEDENCE[e.op] ?? 0;
    case 'conditional':
      return 0;
    case 'unary':
      return UNARY;
    default:
      return POSTFIX;
  }
};

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

export const quote = (s: string): string => `'${s.replace(/[\\'\n\r\t]/g, (c) => ESCAPES[c] ?? c)}'`;

function literal(type: string, value: boolean | number | string | null): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (
    typeof value === 'number' &&
    type === 'double' &&
    Number.isFinite(value) &&
    !/[.eE]/.test(String(value))
  )
    return `${value}.0`;
  return String(value);
}

const list = (es: readonly Expr[]): string => es.map((e) => print(e)).join(', ');

function printBinary(top: BinaryNode): string {
  const spine: BinaryNode[] = [top];
  let first = top.left;
  // extend while the left operand needs no parentheses at its parent's precedence
  for (;;) {
    const parent = spine[spine.length - 1] as BinaryNode;
    if (first.kind !== 'binary' || (BINARY_PRECEDENCE[first.op] ?? 0) < (BINARY_PRECEDENCE[parent.op] ?? 0))
      break;
    spine.push(first);
    first = first.left;
  }
  const innermost = spine[spine.length - 1] as BinaryNode;
  let out = print(first, BINARY_PRECEDENCE[innermost.op] ?? 0);
  for (let i = spine.length - 1; i >= 0; i--) {
    const n = spine[i] as BinaryNode;
    out += ` ${n.op} ${print(n.right, (BINARY_PRECEDENCE[n.op] ?? 0) + 1)}`;
  }
  return out;
}

function raw(e: Expr): string {
  switch (e.kind) {
    case 'literal':
      return literal(e.type, e.value);
    case 'ident':
      return e.name;
    case 'member':
      return `${print(e.object, POSTFIX)}.${e.field}`;
    case 'index':
      return `${print(e.object, POSTFIX)}[${print(e.index)}]`;
    case 'call':
      return e.target === undefined
        ? `${e.name}(${list(e.args)})`
        : `${print(e.target, POSTFIX)}.${e.name}(${list(e.args)})`;
    case 'has':
      return `has(${print(e.select)})`;
    case 'comprehension':
      return `${print(e.range, POSTFIX)}.${e.macro}(${e.variable}, ${print(e.body)})`;
    case 'unary':
      return `${e.op}${print(e.operand, UNARY)}`;
    case 'binary':
      return printBinary(e);
    case 'conditional':
      return `${print(e.test, 1)} ? ${print(e.then, 1)} : ${print(e.else)}`;
    case 'list':
      return `[${list(e.elements)}]`;
    case 'map':
      return `{${e.entries.map((en) => `${print(en.key)}: ${print(en.value)}`).join(', ')}}`;
  }
}

/** The source form of an expression; `minPrecedence` is the strength of the context it is written into. */
export function print(e: Expr, minPrecedence = 0): string {
  const s = raw(e);
  return prec(e) < minPrecedence ? `(${s})` : s;
}
