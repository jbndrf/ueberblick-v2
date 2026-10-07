/** Input schemas of the tools (zod: validated before a tool runs; JSON Schema for `tools/list`). */
import { z } from '@ueberblick/core/zod';
import { ACTOR_KINDS } from '@ueberblick/core';
import type { Op } from '../doc';
import { MAX_OPS, MAX_PATH_LENGTH } from './limits';

const key = z.string().regex(/^[a-z][a-z0-9_]*$/, 'a config key: lower case letters, digits and _');
const path = z.string().min(1).max(MAX_PATH_LENGTH);
const json: z.ZodType<unknown> = z.unknown();

/** One edit (`docs/08-builder.md` "Document model"); the same `Op` the builder's lenses send. */
export const OpSchema: z.ZodType<Op> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('set'), path, value: json }),
  z.strictObject({ kind: z.literal('add'), path, value: json }),
  z.strictObject({ kind: z.literal('hide'), path }),
  z.strictObject({ kind: z.literal('unhide'), path }),
  z.strictObject({ kind: z.literal('reset'), path }),
]) as z.ZodType<Op>;

const ops = z.array(OpSchema).min(1).max(MAX_OPS);
const locale = z.string().min(2).max(8).default('en');

export const ActorSchema = z.strictObject({
  id: z.string().min(1).max(200).default('assistant-simulation'),
  kind: z.enum(ACTOR_KINDS.keys as unknown as [string, ...string[]]),
  roles: z.array(key).max(50).default([]),
});

const jsonObject = z.record(z.string().max(200), json);

export const ReadConfigInput = z.strictObject({
  /** A top-level key of the project file (`types`, `tasks`, `rules`, …); absent: the whole effective file. */
  section: z.string().min(1).max(64).optional(),
});
export const ReadProblemsInput = z.strictObject({ locale });
export const ReadSchemaInput = z.strictObject({});
export const ProposeInput = z.strictObject({ ops, locale });
export const SimulateInput = z.strictObject({
  /** Ops applied to the draft in memory before the simulation (nothing is stored). */
  ops: z.array(OpSchema).max(MAX_OPS).default([]),
  actor: ActorSchema,
  /** A sandbox feature of this type with generated values; `properties` overrides some of them. */
  feature: z.strictObject({ type: key, properties: jsonObject.default({}) }).optional(),
  /** The task to dry-run; absent: only which tasks are offered. */
  task: key.optional(),
  input: jsonObject.default({}),
});
export const ApplyInput = z.strictObject({
  ops,
  /** The `baseRevision` of the proposal. */
  baseRevision: z.number().int().min(0),
  /** The token a human issued for exactly these ops on this revision. */
  confirmation: z.string().min(3).max(512),
});

/** What the human step sends: the ops of a proposal and the revision it was made on. */
export const ConfirmInput = z.strictObject({ ops, baseRevision: z.number().int().min(0) });
