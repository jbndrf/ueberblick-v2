import type { Expr } from '../ast';

/** Compact, span-free rendering of an AST, used by the corpus to pin the tree shape. */
export function toSexpr(e: Expr): string {
  switch (e.kind) {
    case 'literal':
      if (e.type === 'string') return JSON.stringify(e.value);
      if (e.type === 'double' && Number.isInteger(e.value)) return `${String(e.value)}.0`;
      return String(e.value);
    case 'ident':
      return e.name;
    case 'member':
      return `(. ${toSexpr(e.object)} ${e.field})`;
    case 'index':
      return `([] ${toSexpr(e.object)} ${toSexpr(e.index)})`;
    case 'call':
      return e.target
        ? `(.${e.name} ${[e.target, ...e.args].map(toSexpr).join(' ')})`
        : `(${[e.name, ...e.args.map(toSexpr)].join(' ')})`;
    case 'has':
      return `(has ${toSexpr(e.select)})`;
    case 'comprehension':
      return `(${e.macro} ${toSexpr(e.range)} ${e.variable} ${toSexpr(e.body)})`;
    case 'unary':
      return `(${e.op} ${toSexpr(e.operand)})`;
    case 'binary':
      return `(${e.op} ${toSexpr(e.left)} ${toSexpr(e.right)})`;
    case 'conditional':
      return `(?: ${toSexpr(e.test)} ${toSexpr(e.then)} ${toSexpr(e.else)})`;
    case 'list':
      return `[${e.elements.map(toSexpr).join(' ')}]`;
    case 'map':
      return `{${e.entries.map((en) => `${toSexpr(en.key)} ${toSexpr(en.value)}`).join(' ')}}`;
  }
}
