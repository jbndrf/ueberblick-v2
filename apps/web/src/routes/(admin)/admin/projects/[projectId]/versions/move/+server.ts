import { pinMoveHandler, pinMovePlanHandler } from '../../../../../../../lib/server/handlers/admin';
import { buildPlan } from '@ueberblick/builder';
import type { TemplateFile } from '@ueberblick/core';
import type { RequestHandler } from './$types';

// "Auf aktuelle Version verschieben" (WP-368, owner P3): GET is the dry run, POST executes. The admin handlers read the
// project from `params.project`; this page route names it `projectId`.
const call = (e: Parameters<RequestHandler>[0]) => ({
  request: e.request,
  locals: e.locals,
  getClientAddress: e.getClientAddress,
  params: { project: e.params.projectId },
});

// The mapping requirements are the builder's (`buildPlan`); this route may import the builder, `lib/` may not.
const requirementsOf = (before: TemplateFile, after: TemplateFile) =>
  buildPlan({ deployed: before, effective: after, featureCounts: {} }).mappings;

/** The dry run: `?version=N&locale=de`. */
export const GET: RequestHandler = (e) => pinMovePlanHandler(call(e), requirementsOf);

/** The move: `{ version, mappings }`. */
export const POST: RequestHandler = (e) => pinMoveHandler(call(e));
