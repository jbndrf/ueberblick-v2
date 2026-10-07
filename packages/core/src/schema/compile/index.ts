/**
 * compile(): the project file -> the compiled form that every runtime consumes (docs/05, docs/06).
 * Resolves references, type-checks all expressions through `expr.check`, reports unreachable
 * options and tasks and rule cycles, and `diff` classifies changes. Pure: no I/O.
 * Lock violations need the overlay, so `template.merge` finds them; `problemsFromMergeIssues`
 * turns them into Problems.
 */
import type { TemplateFile } from '../file';
import { NO_ASSETS, resolveAssets, type AssetResolver } from './assets';
import { embedRefs } from './embed-refs';
import { checkToolSettings } from './tools';
import { checkPacks } from './packs';
import { checkSelectRoles } from './select-roles';
import { checkMapStyles, type MapStyleChecker } from './map-style';
import type { CompileResult } from './contract';
import { checkRuleCycles } from './cycles';
import { diff } from './diff';
import { isOrderOnly } from './order-only';
import { ExprPass } from './exprs';
import { checkFilterPresets } from '../../filters/compile';
import { contentHash } from './hash';
import { orderSignature } from '../../template/order';
import { CompiledConfigError, hydrate, serialize } from './hydrate';
import { buildIndexes } from './indexes';
import { checkDerive } from './derive';
import { checkPersonal } from './personal';
import { checkComputed } from './computed';
import { checkProcesses } from './process';
import { checkMarkers, resolveMarkerIcons } from './marker';
import { checkStart } from './start';
import { buildViews, foldSchema, sqlInverse } from './views';
import { checkReservedKeys } from './reserved';
import { checkVisibleWhen } from './visible';
import { checkTaskFieldsWritable } from './writable';
import { Sink, problemsFromMergeIssues } from './problems';
import { checkAvailability, checkDeadOptions } from './reach';
import { checkReferences } from './refs';
import { checkAutos } from './autos-check';
import { checkAutoValues, checkWho } from './who-check';
import { checkFamily } from './family';

export { checkEnvFor, type CheckEnvResult, type UnknownTypeError } from './check-env';
export { embedRefs, NO_ASSETS };
export type { AssetResolver } from './assets';
export type { MapStyleChecker, MapStyleError } from './map-style';
export type { RefResolver } from './embed-refs';
export { COMPILED_FORMAT } from './contract';
export { autoId, autoPath, listAutos, splitAutoId, timingOf, type Auto, type AutoId } from './autos';
export type {
  CompiledConfig,
  CompiledConfigData,
  CompiledExpr,
  CompileApi,
  CompileResult,
  DiffEntry,
  Problem,
  ProblemParams,
} from './contract';
export {
  CompiledConfigError,
  contentHash,
  diff,
  isOrderOnly,
  foldSchema,
  hydrate,
  problemsFromMergeIssues,
  serialize,
  sqlInverse,
};
export type { CompiledConfigErrorCode } from './hydrate';

/** What a caller adds to a compile: the project bundle, as a resolver for `$ref`s (R2: compile reads no files). */
export interface CompileOptions {
  /** Required (R11): `NO_ASSETS` for a self-contained file, a bundle resolver at ingestion (B-013). */
  readonly assets: AssetResolver;
  /** The Style Spec check of `map.layers.*.advanced` (core cannot load the spec); omitted: not checked. */
  readonly mapStyles?: MapStyleChecker;
}

export function compile(input: TemplateFile, options: CompileOptions): CompileResult {
  const sink = new Sink();
  // Everything below, the hash included, sees the file with its styles embedded: no `$ref` is left.
  const file = resolveMarkerIcons(resolveAssets(input, options.assets, sink), options.assets, sink);
  checkToolSettings(file, sink);
  checkMapStyles(file, options.mapStyles, sink);
  checkPacks(file, sink);
  checkSelectRoles(file, sink);
  checkReservedKeys(file, sink);
  checkReferences(file, sink);
  checkAutos(file, sink);
  checkWho(file, sink);
  checkAutoValues(file, sink);
  checkFamily(file, sink);
  checkProcesses(file, sink);
  checkMarkers(file, sink);
  checkStart(file, sink);
  const pass = new ExprPass(file, sink);
  pass.run();
  checkComputed(file, pass.expressions, sink);
  sink.problems.push(...checkFilterPresets(file));
  checkAvailability(file, pass.expressions, sink);
  checkDeadOptions(file, pass.expressions, sink);
  checkDerive(file, pass.expressions, sink);
  checkPersonal(file, sink);
  checkVisibleWhen(file, pass.expressions, sink);
  checkTaskFieldsWritable(file, sink);
  checkRuleCycles(file, sink);
  if (sink.problems.length > 0) return { ok: false, problems: [...sink.problems, ...sink.warnings] };
  return {
    ok: true,
    warnings: sink.warnings,
    config: {
      file,
      // Key order is served config (A-042): two files that differ only in order are two versions.
      hash: contentHash({ file, order: orderSignature(file) }),
      expressions: pass.expressions,
      ...buildIndexes(file),
      ...buildViews(file, pass.expressions),
    },
  };
}
