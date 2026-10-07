/**
 * Glue between the device's tool data service (`@ueberblick/client` `createToolData`) and the tool host's
 * `ctx.data` (WP-683, B-020): which tools have a stream for this person. The port itself is `device-data.ts`.
 */
import type { ToolAvailability } from '@ueberblick/core/registry';

/**
 * The keys of `toolKeys` the person's roles have (offered or active): the device pulls and sends only these. The rule
 * is core's `toolAvailabilityFor(file, roleKeys, key)` (the one the server's access check uses too, R1): pass it
 * as `availability`, so there is no second rule here.
 */
export function availableToolKeys(
  availability: (toolKey: string) => ToolAvailability | undefined,
  toolKeys: readonly string[],
): readonly string[] {
  return toolKeys.filter((k) => availability(k) !== undefined);
}
