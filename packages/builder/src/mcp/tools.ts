/**
 * The tools (H4). Reads: `read_config`, `read_problems`, `read_schema`. Proposals: `propose` (ops to
 * diff and problems) and `simulate` (the WP-202 session on the proposed file). Write: `apply`, only
 * with a human's confirmation token (O15). Every edit is `Doc.apply` (R3); the draft is only read and
 * written through the `DraftPort`, i.e. the draft endpoints with their revision check (A-011).
 */
import {
  diff,
  projectFileJsonSchema,
  type Actor,
  type FeatureId,
  type Json,
  type Key,
} from '@ueberblick/core';
import { problemsReport } from '../problems';
import { openSimulation } from '../simulate';
import { verify } from './confirm';
import { defineTool, type DraftRead, type AnyTool, type ToolContext, type ToolResult } from './contract';
import { applyOps, type Refusal } from './proposal';
import {
  ApplyInput,
  ProposeInput,
  ReadConfigInput,
  ReadProblemsInput,
  ReadSchemaInput,
  SimulateInput,
} from './schemas';

const fail = (r: Refusal | { code: string; message: string; [k: string]: unknown }): ToolResult => ({
  error: true,
  value: r,
});

async function readDraft(ctx: ToolContext): Promise<DraftRead | ToolResult> {
  const r = await ctx.draft.read();
  return r.ok ? r.draft : fail({ code: r.code, message: r.message });
}
const isResult = (x: DraftRead | ToolResult): x is ToolResult => 'value' in x;

export const readConfig = defineTool({
  name: 'read_config',
  description:
    'The effective project file (template merged with the overlay) of the working draft, or one top-level section of it, with the draft revision.',
  input: ReadConfigInput,
  writes: false,
  async run(input, ctx) {
    const draft = await readDraft(ctx);
    if (isResult(draft)) return draft;
    const applied = applyOps(draft, []);
    if (!applied.ok) return fail(applied.refusal);
    const file = applied.after.effective() as unknown as Record<string, unknown>;
    if (input.section !== undefined && !(input.section in file))
      return fail({
        code: 'unknown_section',
        message: `The file has no section ${input.section}.`,
        sections: Object.keys(file),
      });
    return {
      value: { revision: draft.revision, config: input.section === undefined ? file : file[input.section] },
    };
  },
});

export const readProblems = defineTool({
  name: 'read_problems',
  description:
    'The problems of the working draft: the list the builder panel shows, with key paths and hints.',
  input: ReadProblemsInput,
  writes: false,
  async run(input, ctx) {
    const draft = await readDraft(ctx);
    if (isResult(draft)) return draft;
    const applied = applyOps(draft, []);
    if (!applied.ok) return fail(applied.refusal);
    return { value: { baseRevision: draft.revision, ...problemsReport(applied.after, input.locale) } };
  },
});

export const readSchema = defineTool({
  name: 'read_schema',
  description: 'The JSON Schema of the project file: what keys and values a file and its ops may use.',
  input: ReadSchemaInput,
  writes: false,
  run: () => Promise.resolve({ value: projectFileJsonSchema() }),
});

export const propose = defineTool({
  name: 'propose',
  description:
    'Apply ops to the working draft in memory and report the diff of the effective file, the overlay text and the problems. Nothing is stored. A human confirms a proposal before `apply`.',
  input: ProposeInput,
  writes: false,
  async run(input, ctx) {
    const draft = await readDraft(ctx);
    if (isResult(draft)) return draft;
    const applied = applyOps(draft, input.ops);
    if (!applied.ok) return fail({ ...applied.refusal, baseRevision: draft.revision });
    const report = problemsReport(applied.after, input.locale);
    return {
      value: {
        baseRevision: draft.revision,
        changes: diff(applied.before.effective(), applied.after.effective()),
        overlay: { before: applied.before.save().overlaySrc, after: applied.after.save().overlaySrc },
        problems: report.problems,
        problemCount: { before: applied.before.problems().length, after: report.count },
        next: 'A human confirms the change and issues a confirmation token; then call apply with the same ops, baseRevision and that token.',
      },
    };
  },
});

export const simulate = defineTool({
  name: 'simulate',
  description:
    'Run the project file (the draft, with optional ops applied in memory) in the simulator: which tasks are offered to an actor on a generated feature and, for a task, a dry run with its runs, rule runs and state changes. Nothing is stored.',
  input: SimulateInput,
  writes: false,
  async run(input, ctx) {
    const draft = await readDraft(ctx);
    if (isResult(draft)) return draft;
    const applied = applyOps(draft, input.ops);
    if (!applied.ok) return fail(applied.refusal);
    const opened = openSimulation(applied.after.effective());
    if (!opened.ok)
      return fail({
        code: 'does_not_compile',
        message: 'The file has problems, so it cannot run.',
        problems: opened.problems,
      });
    const sim = opened.simulation;
    const actor: Actor = {
      id: input.actor.id,
      kind: input.actor.kind as Actor['kind'],
      roles: input.actor.roles as Key[],
    };
    let feature: FeatureId | undefined;
    if (input.feature !== undefined) {
      if (!sim.config.file.types || !(input.feature.type in sim.config.file.types))
        return fail({ code: 'unknown_type', message: `The file has no feature type ${input.feature.type}.` });
      feature = sim.generate(input.feature.type as Key, input.feature.properties as { [k: string]: Json });
    }
    const availability = feature === undefined ? undefined : sim.availability(feature, actor);
    const result =
      input.task === undefined
        ? undefined
        : sim.submit(
            {
              task: input.task as Key,
              actor,
              ...(feature === undefined ? {} : { feature }),
              input: input.input as { [k: string]: Json },
            },
            { commit: false },
          );
    return {
      value: {
        baseRevision: draft.revision,
        feature,
        before: feature && sim.feature(feature),
        availability,
        result,
      },
    };
  },
});

export const apply = defineTool({
  name: 'apply',
  description:
    'Save the ops to the working draft. Needs `confirmation`, a token a human issued for exactly these ops on this baseRevision; a draft that changed since is refused (stale_revision). Does not deploy.',
  input: ApplyInput,
  writes: true,
  async run(input, ctx) {
    const draft = await readDraft(ctx);
    if (isResult(draft)) return draft;
    if (draft.revision !== input.baseRevision)
      return fail({
        code: 'stale_revision',
        message: 'The draft changed since the proposal; read it and propose again.',
        currentRevision: draft.revision,
      });
    const applied = applyOps(draft, input.ops);
    if (!applied.ok) return fail(applied.refusal);
    const overlay = applied.after.save().overlaySrc;
    const check = verify(ctx.confirmation, input.confirmation, ctx.project, input.baseRevision, overlay);
    if (!check.ok)
      return fail({
        code: check.expired ? 'confirmation_expired' : 'confirmation_invalid',
        message:
          'A human has to confirm exactly this change; the token is missing, expired or belongs to other ops or another revision.',
      });
    const w = await ctx.draft.write(overlay, input.baseRevision);
    if (w.ok)
      return {
        value: { revision: w.revision, problemCount: applied.after.problems().length, deployed: false },
      };
    if (w.code === 'stale_revision')
      return fail({
        code: 'stale_revision',
        message: 'The draft changed while applying; nothing was written.',
        currentRevision: w.currentRevision,
      });
    return fail({ code: w.code, message: w.message });
  },
});

/** The tools of the server, in the order `tools/list` shows them. */
export const defaultTools: readonly AnyTool[] = [
  readConfig,
  readProblems,
  readSchema,
  propose,
  simulate,
  apply,
];
