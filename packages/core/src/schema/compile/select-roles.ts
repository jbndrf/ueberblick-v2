/** WP-725: the roles of a participant property's `select` must be roles of the file. */
import type { TemplateFile } from '../file';
import { kp } from './kp';
import type { Sink } from './problems';
import { refuseUnknownRole } from './unknown-role';

export function checkSelectRoles(file: TemplateFile, sink: Sink): void {
  const declared = Object.keys(file.roles ?? {});
  for (const [typeKey, type] of Object.entries(file.types ?? {})) {
    for (const [prop, property] of Object.entries(type.properties ?? {})) {
      for (const which of ['all', 'self'] as const) {
        property.select?.[which]?.forEach((role, i) =>
          refuseUnknownRole(
            sink,
            declared,
            role,
            kp('types', typeKey, 'properties', prop, 'select', which, i),
            'select_unknown_role',
            { en: `${typeKey}.${prop} select.${which}`, de: `${typeKey}.${prop} select.${which}` },
            { type: typeKey, property: prop },
          ),
        );
      }
    }
  }
}
