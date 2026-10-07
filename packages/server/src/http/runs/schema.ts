/**
 * Request and response schemas of the run endpoints (WP-105). They are the typed API (H4): assistants, QGIS and
 * the device queue all speak exactly these shapes. CONTRACT: changes need the lead.
 *
 * - `POST /api/p/<project>/runs` takes a `RunRequest` and answers one `RunResponse`.
 * - `POST /api/p/<project>/runs/batch` takes a `BatchRequest` and answers one `BatchResponse`.
 * - The actor is never in the body: it is the session's principal. `causedBy` is not accepted either (only rules
 *   cause runs). Unknown fields are a 400, so a typo never silently drops data.
 */
import { z } from '@ueberblick/core/zod';
import { JsonSchema, KeySchema, SYNC_PROTOCOL_VERSION } from '@ueberblick/core';

const Uuid = z.uuid();
const Instant = z.iso.datetime({ offset: true });
/** The device-to-server protocol version, on every reply (WP-144): the one `SYNC_PROTOCOL_VERSION` of sync. */
const Version = z.literal(SYNC_PROTOCOL_VERSION);
const Seq = z.number().int().nonnegative();

/** One run as a client sends it (the actor comes from the session). */
export const RunRequestSchema = z.strictObject({
  id: Uuid.describe('UUIDv7 minted on the device; the idempotency key.'),
  task: KeySchema,
  configVersion: z.number().int().positive().describe('The config version the run was planned against.'),
  featureId: Uuid.optional(),
  input: z.record(z.string(), JsonSchema),
  clientTime: Instant.optional(),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

/** Runs of one atomic batch: all share one `configVersion`, ids are unique. */
export const BatchRequestSchema = z.strictObject({
  runs: z.array(RunRequestSchema).min(1),
});
export type BatchRequest = z.infer<typeof BatchRequestSchema>;

export const RefusalSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});

export const SeqRangeSchema = z.object({ from: Seq, to: Seq });

export const RecordedObservationSchema = z.object({
  featureId: z.string(),
  property: z.string(),
  result: JsonSchema,
  phenomenonTime: z.string().optional(),
  resultTime: z.string().optional(),
  seq: Seq,
  runId: z.string(),
});

/** One accepted run; inside a batch result it has no `v` (the envelope carries it). */
const AcceptedRunSchema = z.object({
  outcome: z.literal('accepted'),
  runId: z.string(),
  seq: SeqRangeSchema,
  observations: z.array(RecordedObservationSchema),
});

const RefusedRunSchema = z.object({
  outcome: z.literal('refused'),
  runId: z.string(),
  refusal: RefusalSchema,
});

/** A run made against a config version the server no longer holds: kept for review, never dropped (docs/07). */
export const ReviewSchema = z.object({
  v: Version,
  outcome: z.literal('review'),
  runId: z.string(),
  reason: z.literal('config_version_gone'),
  configVersion: z.number().int(),
});

export type ReviewResponse = z.infer<typeof ReviewSchema>;

/** 200 accepted, 422 refused, 409 review. A repeated run id answers the stored result again. */
export const RunResponseSchema = z.discriminatedUnion('outcome', [
  AcceptedRunSchema.extend({ v: Version }),
  RefusedRunSchema.extend({ v: Version }),
  ReviewSchema,
]);
export type RunResponse = z.infer<typeof RunResponseSchema>;

/** 200 accepted (one result per run, in order, one seq range), 422 refused (nothing is stored), 409 review. */
export const BatchResponseSchema = z.discriminatedUnion('outcome', [
  z.object({
    v: Version,
    outcome: z.literal('accepted'),
    results: z.array(AcceptedRunSchema),
    seq: SeqRangeSchema,
  }),
  z.object({
    v: Version,
    outcome: z.literal('refused'),
    index: z.number().int().nonnegative(),
    runId: z.string(),
    refusal: RefusalSchema,
  }),
  ReviewSchema,
]);
export type BatchResponse = z.infer<typeof BatchResponseSchema>;
