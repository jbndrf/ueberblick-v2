/**
 * Who a participant may choose for a `participant` property (B-022, WP-756, H8): the web form offers
 * `participantChoice(...)`, and plan refuses what it would not have offered (R1, one function). Only a bound actor
 * (a participant) is held to it; an import, a rule or the system writes any member.
 */
import { isEmptyValue } from '../form/empty';
import type { Json, Refusal } from '../model';
import { participantChoice } from '../registry/participant-select';
import { isBound, refuse, type Env } from './scope';
import type { Run } from '../model';
import type { TypeDecl } from './values';

/**
 * The first submitted participant value the run's actor may not choose, as a `not_permitted` refusal: someone else
 * without `select.all`, anybody without `select.self`, or (with `ports.isParticipant`) a non-member.
 */
export function participantRefusal(
  env: Env,
  run: Run,
  declared: TypeDecl | undefined,
  values: Readonly<Record<string, Json>>,
): Refusal | undefined {
  if (!isBound(run.actor) || declared === undefined) return undefined;
  for (const [key, value] of Object.entries(values)) {
    const p = declared.properties[key];
    if (p?.type !== 'participant' || isEmptyValue(value) || typeof value !== 'string') continue;
    const allowed = participantChoice(p, run.actor.roles);
    const path = `form.${key}`;
    if (!allowed.everyone && !(allowed.oneself && value === run.actor.id))
      return refuse('not_permitted', `the actor may not choose '${value}' for '${key}'`, path);
    if (allowed.everyone && env.ports.isParticipant?.(value) === false)
      return refuse('not_permitted', `'${value}' is not a participant of this project`, path);
  }
  return undefined;
}
