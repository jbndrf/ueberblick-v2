// Tool platform v2 (WP-613): the role's tool entry. The option schemas and their pure functions are in
// `registry/tool-options.ts` (participant code may import the registry, not this folder).
import { z } from '../zod';
import { TOOL_AVAILABILITY } from '../registry';
import { JsonObjectSchema } from './primitives';

/** `roles.<role>.app.tools.<key>`: how this role has the tool, plus the role's settings of it. A tool
 * the role does not list does not exist for it. `availability` defaults to `active` (on at first). */
export const RoleToolSchema = z
  .strictObject({
    availability: z
      .enum(TOOL_AVAILABILITY.keys as unknown as [string, ...string[]])
      .optional()
      .describe('offered: off at first, the person may switch it on. active (default): on at first.'),
    settings: JsonObjectSchema.optional().describe(
      'Settings of this tool for this role; the tool checks them.',
    ),
  })
  .describe('One tool of a role app.');
export type RoleTool = z.infer<typeof RoleToolSchema>;
