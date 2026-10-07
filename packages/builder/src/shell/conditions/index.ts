/** Shared condition editing helpers (chips over core `toChips`, text fallback) of the builder. */
export {
  appendChip,
  chipsOfSource,
  chipsToSource,
  literalText,
  parseLiteral,
  removeChip,
  updateChip,
} from './chips';
export type { CompareChip, LiteralResult } from './chips';
export { conditionOf } from './model';
export type { ConditionView } from './model';
