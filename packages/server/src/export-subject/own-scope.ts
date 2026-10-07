import type { Db } from '../db/driver';
import type { PersonalProperty } from './personal';
import { redactionMarker } from './registry';

interface OwnRef {
  seq: number;
  run_id: string;
  feature_id: string;
  property: string;
}

/** What one run wrote of the properties whose value can be about someone else. */
interface RunSeen {
  readonly kept: Set<string>;
  readonly dropped: Set<string>;
}

/**
 * Which of the subject's own writes are about the subject (B-005, GDPR Art. 15: the export must not hand out
 * another person's data). A write is kept unless it sets a personal property whose subject is somebody else:
 * `actor` kind is about the author, `feature` kind about the feature, `property:<key>` about the participant
 * that `<key>` named at that moment (the same rule the export uses for other authors' values).
 * One pass over the subject's observations, decided once, then read by the observation rows and the run redaction.
 */
export function createOwnScope(
  db: Db,
  subjectId: string,
  personal: readonly PersonalProperty[],
  featureType: (id: string) => string | undefined,
) {
  const byProperty = new Map<string, PersonalProperty[]>();
  for (const p of personal) byProperty.set(p.property, [...(byProperty.get(p.property) ?? []), p]);
  const sensitive = new Set(personal.filter((p) => p.kind !== 'actor').map((p) => p.property));
  const own = db.prepare<OwnRef>(
    `SELECT o.seq, o.run_id, o.feature_id, o.property FROM observations o
       JOIN runs r ON r.id = o.run_id WHERE r.actor = ? ORDER BY o.seq`,
  );
  const latestNamed = db.prepare<{ result: string | null }>(
    `SELECT k.result FROM observations k
      WHERE k.feature_id = ? AND k.property = ? AND (k.seq < ? OR k.run_id = ?)
      ORDER BY k.seq DESC LIMIT 1`,
  );
  const named = JSON.stringify(subjectId);

  function aboutSubject(r: OwnRef): boolean {
    const type = featureType(r.feature_id);
    const candidates = (byProperty.get(r.property) ?? []).filter(
      (p) => type === undefined || p.type === type,
    );
    return candidates.every((p) => {
      if (p.kind === 'actor') return true;
      if (p.kind === 'feature') return r.feature_id === subjectId;
      return p.via !== undefined && latestNamed.get(r.feature_id, p.via, r.seq, r.run_id)?.result === named;
    });
  }

  const dropped = new Set<number>();
  const seen = new Map<string, RunSeen>();
  let scanned = false;
  function scan(): void {
    if (scanned) return;
    scanned = true;
    for (const r of own.iterate(subjectId)) {
      const keep = aboutSubject(r);
      if (!keep) dropped.add(r.seq);
      if (!sensitive.has(r.property)) continue;
      let s = seen.get(r.run_id);
      if (s === undefined) seen.set(r.run_id, (s = { kept: new Set(), dropped: new Set() }));
      (keep ? s.kept : s.dropped).add(r.property);
    }
  }

  /** The value of an input field is redacted when the run's observations of that property were left out, or when none show whom it is about. */
  function redactInput(runId: string, input: unknown): { value: unknown; redacted: boolean } {
    scan();
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      return { value: input, redacted: false };
    const s = seen.get(runId);
    let redacted = false;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(input)) {
      const property = key.slice(key.lastIndexOf('.') + 1);
      const hide =
        sensitive.has(property) && (s === undefined || s.dropped.has(property) || !s.kept.has(property));
      if (hide) redacted = true;
      out[key] = hide ? redactionMarker('other_subject') : v;
    }
    return { value: out, redacted };
  }

  /** A refusal message can quote a value; when the input was redacted the message is too. */
  function redactResult(result: unknown): unknown {
    if (typeof result !== 'object' || result === null) return result;
    const refusal = (result as { refusal?: unknown }).refusal;
    if (typeof refusal !== 'object' || refusal === null || !('message' in refusal)) return result;
    return { ...result, refusal: { ...refusal, message: redactionMarker('other_subject') } };
  }

  return {
    keeps: (seq: number): boolean => {
      scan();
      return !dropped.has(seq);
    },
    redactInput,
    redactResult,
  };
}
