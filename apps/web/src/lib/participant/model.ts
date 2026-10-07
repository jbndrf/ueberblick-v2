/** What the route derives from the project file and the participant's roles. Pure; the shell does the rest (H3). */
import type { TemplateFile } from '@ueberblick/core/model';

/**
 * The role whose app profile the participant sees: the first of their roles that the file declares. A participant with
 * several roles gets one app (the first declared), never a merge; a role the file does not declare gives none, and the
 * shell then shows every view and tool of the project (its documented default for a role without a profile).
 */
export function roleKeyOf(file: TemplateFile, roles: readonly string[]): string | undefined {
  return roles.find((r) => file.roles?.[r] !== undefined);
}
