import { z } from '../zod';
import { KeySchema } from './primitives';

/**
 * Who may choose whom for a `participant` or `role` property (v3 `any_select_roles` / `self_select_roles`, WP-725): a caller
 * whose role is in `all` may choose any participant of the project, one in `self` only themselves (a role property: only the roles they hold). Absent: self (a role property: any role).
 */
export const ParticipantSelectSchema = z
  .strictObject({
    all: z
      .array(KeySchema)
      .optional()
      .describe('Roles that may choose any participant (or role) of the project, by name.'),
    self: z.array(KeySchema).optional().describe('Roles that may choose only themselves.'),
  })
  .describe('participant/role: who may choose whom (v3 any_select_roles / self_select_roles).');
export type ParticipantSelect = z.infer<typeof ParticipantSelectSchema>;
