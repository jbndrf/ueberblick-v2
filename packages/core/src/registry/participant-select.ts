// Who may choose whom for a `participant` property: pure functions, no schema module (zod stays out of the
// participant shell, docs/12). The schema (`schema/property-select.ts`) only describes the `select` shape.
import type { ParticipantSelect } from '../schema/property-select';

/** What a caller may choose for a participant property: everyone, or oneself; neither is v3's default deny. */
export interface ParticipantChoice {
  readonly everyone: boolean;
  readonly oneself: boolean;
}

const hits = (roles: readonly string[], listed: readonly string[] | undefined): boolean =>
  listed !== undefined && roles.some((r) => listed.includes(r));

export function participantChoice(
  property: { readonly select?: ParticipantSelect | undefined },
  roles: readonly string[],
): ParticipantChoice {
  const select = property.select;
  if (select === undefined) return { everyone: false, oneself: true };
  const everyone = hits(roles, select.all);
  return { everyone, oneself: everyone || hits(roles, select.self) };
}

/** True when some participant property of the types lets a caller with these roles choose any participant. */
export function choosesAnyParticipant(
  types:
    | Readonly<
        Record<
          string,
          {
            readonly properties?: Readonly<
              Record<string, { readonly type: string; readonly select?: ParticipantSelect | undefined }>
            >;
          }
        >
      >
    | undefined,
  roles: readonly string[],
): boolean {
  return Object.values(types ?? {}).some((t) =>
    Object.values(t.properties ?? {}).some(
      (p) => p.type === 'participant' && participantChoice(p, roles).everyone,
    ),
  );
}

/**
 * The roles a caller may choose for a `role` property (WP-481, v3 "Nur Selbstauswahl" / "Kann jeden auswählen"), the
 * same `select` shape as a participant property: no `select` offers every role; with one, a role in `all` may choose
 * any role, one in `self` only the roles it holds, any other none (v3 default deny).
 */
export function allowedRoles(
  property: { readonly select?: ParticipantSelect | undefined },
  actorRoles: readonly string[],
  declared: readonly string[],
): readonly string[] {
  const select = property.select;
  if (select === undefined || hits(actorRoles, select.all)) return declared;
  return hits(actorRoles, select.self) ? declared.filter((r) => actorRoles.includes(r)) : [];
}
