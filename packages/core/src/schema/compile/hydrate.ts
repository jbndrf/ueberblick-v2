/**
 * serialize / hydrate: the stored form of a compiled config (A-005). Hydrating runs no Zod parse,
 * no `compile()` and no type check, so the participant shell can load a config without them.
 * Keep the imports of this module to types, `./indexes`, `./views` and the walker; a spec asserts it.
 */
import type { Expr } from '../../expr/ast';
import type { Ty } from '../../expr/check/types';
import { children } from '../../expr/parse/walk';
import { COMPILED_FORMAT } from './contract';
import type { CompiledConfig, CompiledConfigData, CompiledExpr } from './contract';
import { buildIndexes } from './indexes';
import { buildViews } from './views';

/** `format`: another stored format (recompile from the file). `types_mismatch`: `types` does not fit the AST. */
export type CompiledConfigErrorCode = 'format' | 'types_mismatch';

export class CompiledConfigError extends Error {
  constructor(
    readonly code: CompiledConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CompiledConfigError';
  }
}

/** Nodes in pre-order: depth-first, children in field order (the order of `types` in the data). */
function preorder(root: Expr): Expr[] {
  const out: Expr[] = [];
  const visit = (e: Expr): void => {
    out.push(e);
    for (const c of children(e)) visit(c);
  };
  visit(root);
  return out;
}

/** Plain JSON: the effective file, its hash and every expression as `{ path, source, ast, types }`. */
export function serialize(config: CompiledConfig): CompiledConfigData {
  return {
    format: COMPILED_FORMAT,
    file: config.file,
    hash: config.hash,
    expressions: [...config.expressions.values()].map((e) => ({
      path: e.path,
      source: e.source,
      ast: e.typed.ast,
      types: preorder(e.typed.ast).map((n) => {
        const ty = e.typed.types.get(n);
        if (ty === undefined) {
          throw new CompiledConfigError(
            'types_mismatch',
            `${e.path}: the checker left a node of \`${e.source}\` untyped`,
          );
        }
        return ty;
      }),
    })),
  };
}

/** Rebuilds the runtime form, including the checked type of every node from the stored pre-order list. */
export function hydrate(data: CompiledConfigData): CompiledConfig {
  if (data.format !== COMPILED_FORMAT) {
    throw new CompiledConfigError(
      'format',
      `compiled config has format ${data.format}, this core reads ${COMPILED_FORMAT}: recompile from the stored file`,
    );
  }
  const expressions = new Map<string, CompiledExpr>();
  for (const e of data.expressions) {
    const nodes = preorder(e.ast);
    if (nodes.length !== e.types.length) {
      throw new CompiledConfigError(
        'types_mismatch',
        `${e.path}: ${e.types.length} stored types for ${nodes.length} nodes of \`${e.source}\`: recompile from the stored file`,
      );
    }
    const types = new Map<Expr, Ty>();
    nodes.forEach((n, i) => types.set(n, e.types[i] as Ty));
    expressions.set(e.path, {
      path: e.path,
      source: e.source,
      typed: { ast: e.ast, type: types.get(e.ast) as Ty, types },
    });
  }
  return {
    file: data.file,
    hash: data.hash,
    expressions,
    ...buildIndexes(data.file),
    ...buildViews(data.file, expressions),
  };
}
