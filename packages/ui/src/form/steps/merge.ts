import type { Json } from '../contract';

/**
 * The input of the one run: the values of every step, in step order. Each property belongs to one step (the schema
 * refuses otherwise), so a later step never overwrites an earlier one.
 */
export function mergeStepValues(
  perStep: readonly (Readonly<Record<string, Json>> | undefined)[],
): Record<string, Json> {
  const input: Record<string, Json> = {};
  for (const values of perStep) Object.assign(input, values ?? {});
  return input;
}
