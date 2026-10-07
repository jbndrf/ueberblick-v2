/**
 * The one replay-binding rule (R1, WP-781): whether a run submitted under an id that is already held is the same
 * request again. Used by the run store's ledger (production, over its SQL row) and by the SimServer (over run objects).
 * Same means: the same actor (id and kind), task, canonical input and, when the retry names one, feature. The client
 * time and config version are not compared: an offline retry may be stamped again.
 *
 * `causedBy`: a submitted run never has one (only rule runs do, and their ids bind to nobody), so a held or incoming
 * run with a `causedBy` binds to nothing. `featureId` of the held side is whatever the holder knows: the ledger passes
 * its projection (the created feature of an accepted create run), the SimServer the run's own.
 */
import { canonicalJson } from '../schema/compile/hash';

export interface RunBindingFields {
  readonly actorId: string;
  readonly actorKind: string;
  readonly task: string;
  readonly featureId?: string;
  readonly input: unknown;
  readonly causedBy?: string;
}

export function sameRunBinding(held: RunBindingFields, again: RunBindingFields): boolean {
  return (
    held.causedBy === undefined &&
    again.causedBy === undefined &&
    held.actorId === again.actorId &&
    held.actorKind === again.actorKind &&
    held.task === again.task &&
    (again.featureId === undefined || held.featureId === again.featureId) &&
    canonicalJson(held.input) === canonicalJson(again.input)
  );
}

/** The binding fields of a run object. */
export function bindingFieldsOf(run: {
  readonly actor: { readonly id: string; readonly kind: string };
  readonly task: string;
  readonly featureId?: string;
  readonly input: unknown;
  readonly causedBy?: string;
}): RunBindingFields {
  return {
    actorId: run.actor.id,
    actorKind: run.actor.kind,
    task: run.task,
    input: run.input,
    ...(run.featureId === undefined ? {} : { featureId: run.featureId }),
    ...(run.causedBy === undefined ? {} : { causedBy: run.causedBy }),
  };
}
