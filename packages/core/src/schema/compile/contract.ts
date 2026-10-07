/**
 * compile(): the project file → the one compiled form every runtime consumes (docs/03, docs/05).
 * CONTRACT — written by the lead; changes need the lead. Implemented by WP-013, consumed by
 * perms (WP-042), plan (WP-041), fold (WP-040), the server deploy (WP-112) and the builder.
 * Expressions are parsed and checked here once; runtime code never parses strings (docs/06).
 */
import type { Expr } from '../../expr/ast';
import type { TypedAst } from '../../expr/check/check';
import type { Ty } from '../../expr/check/types';
import type { DiffChange, ProblemCode } from '../../registry/compile';
import type { LocalizedString, TemplateFile } from '../index';
import type { KeyPath } from '../../template/contract';
import type { FoldType } from '../../fold/contract';
import type { Key } from '../../model';
import type { AssetResolver } from './assets';
import type { Auto, AutoId } from './autos';

/**
 * The values a problem's message is made of, flat (the builder fills its catalogue entry `builder_problem_<code>`
 * from them, WP-416). `variant`, when present, picks a wording of the code (registry PROBLEM_VARIANTS).
 */
export type ProblemParams = Readonly<Record<string, string | number>>;

/** A compile problem, addressed so a human or an LLM can fix it (docs/08 problems panel). */
export interface Problem {
  /** Key path into the file (A-005 grammar, built with `formatKeyPath`), e.g. `tasks.kontrolle.form.befund.relevant`. */
  readonly path: KeyPath;
  readonly code: ProblemCode;
  readonly message: LocalizedString;
  /** A concrete fix, phrased as an instruction. */
  readonly hint?: string;
  /** What `message` and `hint` are made of; the builder words the problem from it. Compile sets it on every problem. */
  readonly params?: ProblemParams;
  /** Source span inside an expression string, when the problem is in one. */
  readonly span?: { readonly start: number; readonly end: number };
}

/** A checked expression together with its source, keyed by the path it came from. */
export interface CompiledExpr {
  readonly path: KeyPath;
  readonly source: string;
  readonly typed: TypedAst;
}

export interface CompiledConfig {
  /** The effective file (template merged with the overlay) that was compiled. */
  readonly file: TemplateFile;
  /** SHA-256 (hex) over RFC 8785 canonical JSON of `file` (`config_versions.hash`). */
  readonly hash: string;
  /** Every expression in the file, checked, by key path. */
  readonly expressions: ReadonlyMap<KeyPath, CompiledExpr>;
  /** Tasks offered per feature type key (including `$map` / `$none` offers). */
  readonly tasksByType: ReadonlyMap<string, readonly string[]>;
  /** The automatic actions (`tasks.<task>.auto.<name>`) by id `<task>.<name>`, in file order (C-004). */
  readonly autos: ReadonlyMap<AutoId, Auto>;
  /** Auto ids by trigger (`task.<key>`, property-change triggers, `when`, `elapsed`, `schedule`). */
  readonly autosByTrigger: ReadonlyMap<string, readonly string[]>;
  /**
   * Derived views (built from `file` by compile and hydrate, never stored): the only producers of
   * what fold and evaluate need to know about the config. Consumers do not derive their own (R1).
   * Fold's per-type view; `foldSchema(config, configVersion)` wraps it into a `FoldSchema`.
   */
  readonly foldTypes: ReadonlyMap<Key, FoldType>;
  /** Relation keys per feature type key, for `EvalContext.relations`: declared relations and reference properties. */
  readonly relations: ReadonlyMap<Key, ReadonlySet<Key>>;
}

/** Version of the stored `CompiledConfigData` shape; bump when it changes (A-005). 2: layer styles are embedded, no `$ref` (WP-577). 3: automatic actions `tasks.<t>.auto.<n>` replace `rules`, expression paths moved (C-004). */
export const COMPILED_FORMAT = 3;

/**
 * Content hash of `expr/ast.ts` per stored format (comments and whitespace ignored, see `astHash`
 * in the format spec). `ast.ts` is a persisted format: changing it means bumping COMPILED_FORMAT and
 * recording the new hash under the new number; a test fails otherwise.
 */
export const AST_HASH_BY_FORMAT: Readonly<Record<number, string>> = {
  1: '04cb0b633d8d30f9ba50f10b66cdcc1b1553af53b40c5e42af1f77d75936b2c7',
  2: '04cb0b633d8d30f9ba50f10b66cdcc1b1553af53b40c5e42af1f77d75936b2c7',
  3: '04cb0b633d8d30f9ba50f10b66cdcc1b1553af53b40c5e42af1f77d75936b2c7',
};

/**
 * The stored and shipped form of a compiled config (`config_versions.compiled`, A-005): plain JSON
 * including the checked node types, hydrated without Zod, compile() or the checker. On the server a
 * cache (recompiled from `file` when `format` is older than the running core); a device refetches
 * a version whose `format` it cannot read. `ast.ts` is therefore a persisted format: any change to
 * it bumps COMPILED_FORMAT (a test pins this).
 */
export interface CompiledConfigData {
  readonly format: number;
  readonly file: TemplateFile;
  /** SHA-256 (hex) over RFC 8785 canonical JSON of `file`. */
  readonly hash: string;
  readonly expressions: readonly {
    readonly path: KeyPath;
    readonly source: string;
    readonly ast: Expr;
    /** The checked type of every AST node, in pre-order (depth-first, children in field order). */
    readonly types: readonly Ty[];
  }[];
}

export type CompileResult =
  | { readonly ok: true; readonly config: CompiledConfig; readonly warnings: readonly Problem[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** One entry of `diff(a, b)`. `breaking` changes need a mapping or a migration before deploy. */
export interface DiffEntry {
  readonly path: KeyPath;
  readonly change: DiffChange;
  readonly breaking: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface CompileApi {
  compile(file: TemplateFile, options: { readonly assets: AssetResolver }): CompileResult;
  serialize(config: CompiledConfig): CompiledConfigData;
  /** Rebuilds the runtime form; runs no Zod parse and no type check (participant shell). */
  hydrate(data: CompiledConfigData): CompiledConfig;
  diff(a: TemplateFile, b: TemplateFile): readonly DiffEntry[];
}
