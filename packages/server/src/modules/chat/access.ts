import { toolAvailabilityFor, type ToolProfileFile } from '@ueberblick/core';

/**
 * Does one of the roles have the tool in the deployed config (WP-613 availability: offered or active)? It is core's
 * `toolAvailabilityFor`, the rule the device's shell and tool entries use (R1): the project declares `tools.<key>`, and
 * a role without `app.tools` has the project's tools, active.
 */
export const roleHasTool = (
  file: ToolProfileFile | undefined,
  roles: readonly string[],
  tool: string,
): boolean => file !== undefined && toolAvailabilityFor(file, roles, tool) !== undefined;

export interface ToolMember {
  readonly id: string;
  readonly name: string;
}

/**
 * The people who have the tool: participants (not hidden or disabled) with a role that has it, by name only. The same
 * rule as `roleHasTool`, so the list is exactly the audience the routes let in (v3 `mentionable-participants`).
 */
export function toolMembers(
  file: ToolProfileFile | undefined,
  tool: string,
  rows: readonly { readonly id: string; readonly name: string | null; readonly roles: string }[],
): ToolMember[] {
  const out: ToolMember[] = [];
  for (const row of rows) {
    let roles: unknown;
    try {
      roles = JSON.parse(row.roles);
    } catch {
      continue;
    }
    if (!Array.isArray(roles) || !roles.every((r) => typeof r === 'string')) continue;
    if (roleHasTool(file, roles as string[], tool))
      out.push({ id: row.id, name: row.name === null || row.name.trim() === '' ? row.id : row.name });
  }
  return out;
}
