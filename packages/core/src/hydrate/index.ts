/** core/hydrate: CompiledConfigData -> CompiledConfig without Zod, the checker or the parser (A-005). */
export { hydrate, serialize, CompiledConfigError } from '../schema/compile/hydrate';
export type { CompiledConfigErrorCode } from '../schema/compile/hydrate';
export { COMPILED_FORMAT } from '../schema/compile/contract';
export type { CompiledConfig, CompiledConfigData, CompiledExpr } from '../schema/compile/contract';
