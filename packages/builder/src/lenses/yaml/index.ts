/** The pure parts of the YAML view (docs/08 "Lenses"): schema completion and diagnostics over the overlay text. */
export { completeAt } from './complete';
export type { CompletionOption, Completions } from './complete';
export { diagnose, lineOf, planSave } from './diagnose';
export type { Diagnosis, Diagnostic, SavePlan } from './diagnose';
export { overlayOps } from './overlay-ops';
