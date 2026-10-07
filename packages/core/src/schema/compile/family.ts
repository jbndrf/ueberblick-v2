/** B-019: a relation that draws its children at the parent (`inherit_position`) needs children with no position of their own. */
import type { TemplateFile } from '../file';
import { kp } from './kp';
import type { Sink } from './problems';

export function checkFamily(file: TemplateFile, sink: Sink): void {
  const types = file.types ?? {};
  for (const [tk, type] of Object.entries(types)) {
    for (const [rk, r] of Object.entries(type.relations ?? {})) {
      if (r.inherit_position !== true || r.inverse_of === undefined) continue;
      const [childType, property] = r.inverse_of.split('.') as [string, string];
      const child = types[childType];
      if (child === undefined) continue; // `to` is reported as dangling
      const prop = child.properties[property];
      if (prop === undefined || prop.type !== 'reference' || prop.to !== tk) {
        sink.dangling(
          kp('types', tk, 'relations', rk, 'inverse_of'),
          'reference_property_of',
          property,
          Object.entries(child.properties)
            .filter(([, p]) => p.type === 'reference' && p.to === tk)
            .map(([k]) => k),
          { of: childType, to: tk },
        );
        continue;
      }
      if (child.geometry !== undefined) {
        sink.error(
          kp('types', tk, 'relations', rk, 'inherit_position'),
          'inherit_with_own_geometry',
          `'${childType}' has its own position (geometry '${child.geometry}') but '${tk}.${rk}' draws its children at the parent`,
          `remove 'geometry' from ${childType}, or remove inherit_position from ${tk}.${rk}`,
          { type: childType, geometry: child.geometry, parent: tk, relation: rk },
        );
      }
    }
  }
}
