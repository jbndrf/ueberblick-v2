import { formatKeyPath } from '../../template/paths';
import type { KeyPath } from '../../template/contract';

/**
 * The one way compile builds a key path (A-005 grammar): bare segments, bracketed JSON strings for
 * the rest. A list position is a segment like any other, so `then["0"]` addresses the first step.
 */
export const kp = (...segments: readonly (string | number)[]): KeyPath => formatKeyPath(segments.map(String));
