/**
 * A `role` property holds role keys of the project (v3 selector source "Rollen"). Plan refuses a submitted key the
 * file does not declare, whoever the actor is (A-051), and, for a bound actor, a role its `select` does not allow (A-055).
 */
import { isEmptyValue } from '../form/empty';
import type { Json, Refusal, Run } from '../model';
import { allowedRoles } from '../registry/participant-select';
import { isBound, refuse } from './scope';
import type { TypeDecl } from './values';

/** The first submitted `role` value that is not a declared role, as an `invalid_input` refusal. */
export function roleRefusal(
  roles: { readonly [key: string]: unknown } | undefined,
  declared: TypeDecl | undefined,
  run: Run,
  values: Readonly<Record<string, Json>>,
): Refusal | undefined {
  if (declared === undefined) return undefined;
  for (const [key, value] of Object.entries(values)) {
    const p = declared.properties[key];
    if (p?.type !== 'role' || isEmptyValue(value)) continue;
    const keys = Array.isArray(value) ? value : [value];
    const bad = keys.find((k) => typeof k !== 'string' || !Object.hasOwn(roles ?? {}, k));
    if (bad !== undefined)
      return refuse('invalid_input', `'${String(bad)}' is not a role of this project`, `form.${key}`);
    // `select` holds a participant to what the form offered (A-055); an import, a rule or the system writes any role.
    if (!isBound(run.actor)) continue;
    const allowed = allowedRoles(p, run.actor.roles, Object.keys(roles ?? {}));
    const refused = keys.find((k) => !allowed.includes(k as string));
    if (refused !== undefined)
      return refuse(
        'not_permitted',
        `the actor may not choose the role '${String(refused)}' for '${key}'`,
        `form.${key}`,
      );
  }
  return undefined;
}
