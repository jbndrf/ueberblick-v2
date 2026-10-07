import type { Db } from '../db/driver';
import { createOwnScope } from './own-scope';
import type { PersonalProperty } from './personal';

/** One observation in the export. `run` and `task` are set only for the subject's own runs. */
export interface ExportObservation {
  readonly seq: number;
  readonly feature: string;
  readonly property: string;
  readonly result: string | null;
  readonly phenomenon_time: string | null;
  readonly run?: string;
  readonly task?: string;
  readonly received_at?: string;
  readonly via: 'run' | 'named';
}

export interface RunRow {
  readonly id: string;
  readonly task: string;
  readonly config_version: number;
  readonly input: string;
  readonly client_time: string | null;
  readonly received_at: string;
  readonly outcome: string;
  readonly refusal_code: string | null;
  readonly result: string | null;
  readonly caused_by: string | null;
  readonly seq: number | null;
}

export interface ParticipantRow {
  readonly id: string;
  readonly name: string | null;
  readonly roles: string;
  readonly attrs: string | null;
  readonly disabled_at: string | null;
}

interface OwnRow {
  seq: number;
  run_id: string;
  feature_id: string;
  property: string;
  result: string | null;
  phenomenon_time: string | null;
  task: string;
  received_at: string;
}
interface NamedRow {
  seq: number;
  feature_id: string;
  property: string;
  result: string | null;
  phenomenon_time: string | null;
}

/** The reads of one subject export. Prepared once; every statement uses the observation and run indexes or one scan. */
export function subjectQueries(db: Db, subjectId: string, personal: readonly PersonalProperty[]) {
  // `runs(actor)` has no index yet (docs/research/gdpr-erasure.md section 10): the own-run reads scan `runs` once.
  const participant = db.prepare<ParticipantRow>(
    'SELECT id, name, roles, attrs, disabled_at FROM participants WHERE id = ?',
  );
  const runs = db.prepare<RunRow>(
    `SELECT id, task, config_version, input, client_time, received_at, outcome, refusal_code, result, caused_by, seq
       FROM runs WHERE actor = ? ORDER BY rowid`,
  );
  const own = db.prepare<OwnRow>(
    `SELECT o.seq, o.run_id, o.feature_id, o.property, o.result, o.phenomenon_time, r.task, r.received_at
       FROM observations o JOIN runs r ON r.id = o.run_id WHERE r.actor = ? ORDER BY o.seq`,
  );
  const featureType = db.prepare<{ type: string }>('SELECT type FROM features WHERE id = ?');
  const namedFeatures = db.prepare<{ feature_id: string }>(
    'SELECT DISTINCT feature_id FROM observations WHERE property = ? AND result = ?',
  );
  // The value of a personal property is about the person the participant property named at that moment.
  const namedObs = db.prepare<NamedRow>(
    `SELECT o.seq, o.feature_id, o.property, o.result, o.phenomenon_time
       FROM observations o JOIN runs r ON r.id = o.run_id
      WHERE o.feature_id = ? AND o.property = ? AND r.actor <> ?
        AND (SELECT k.result FROM observations k
              WHERE k.feature_id = o.feature_id AND k.property = ? AND (k.seq < o.seq OR k.run_id = o.run_id)
              ORDER BY k.seq DESC LIMIT 1) = ?
      ORDER BY o.seq`,
  );
  const featureObs = db.prepare<NamedRow>(
    `SELECT o.seq, o.feature_id, o.property, o.result, o.phenomenon_time
       FROM observations o JOIN runs r ON r.id = o.run_id
      WHERE o.feature_id = ? AND o.property = ? AND r.actor <> ? ORDER BY o.seq`,
  );

  /** Observations about the subject that other actors wrote: `property:<key>` and `feature` kinds. Small by nature. */
  function aboutSubject(): ExportObservation[] {
    const found: ExportObservation[] = [];
    const push = (r: NamedRow): number =>
      found.push({
        seq: r.seq,
        feature: r.feature_id,
        property: r.property,
        result: r.result,
        phenomenon_time: r.phenomenon_time,
        via: 'named',
      });
    for (const p of personal) {
      if (p.kind === 'property' && p.via !== undefined) {
        const named = JSON.stringify(subjectId);
        for (const f of namedFeatures.all(p.via, named)) {
          if (featureType.get(f.feature_id)?.type !== p.type) continue;
          for (const r of namedObs.all(f.feature_id, p.property, subjectId, p.via, named)) push(r);
        }
      } else if (p.kind === 'feature' && featureType.get(subjectId)?.type === p.type) {
        for (const r of featureObs.all(subjectId, p.property, subjectId)) push(r);
      }
    }
    return found.sort((a, b) => a.seq - b.seq);
  }

  /** The subject's own observations and the ones about them, merged in `seq` order, lazily for the own ones. */
  function* observations(): Generator<ExportObservation> {
    const about = aboutSubject();
    let i = 0;
    for (const r of own.iterate(subjectId)) {
      if (!scope.keeps(r.seq)) continue;
      for (let a = about[i]; a !== undefined && a.seq < r.seq; a = about[++i]) yield a;
      yield {
        seq: r.seq,
        run: r.run_id,
        task: r.task,
        received_at: r.received_at,
        feature: r.feature_id,
        property: r.property,
        result: r.result,
        phenomenon_time: r.phenomenon_time,
        via: 'run',
      };
    }
    for (let a = about[i]; a !== undefined; a = about[++i]) yield a;
  }

  const featureTypeOf = (id: string): string | undefined => featureType.get(id)?.type;
  const scope = createOwnScope(db, subjectId, personal, featureTypeOf);

  return {
    scope,
    participant: () => participant.get(subjectId),
    runs: () => runs.iterate(subjectId),
    observations,
    featureType: featureTypeOf,
  };
}
