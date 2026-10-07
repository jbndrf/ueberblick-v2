/**
 * What the runner asserts and what it does not, in one place. Nothing is skipped silently: every step kind
 * and every expected-result key is either checked here or carries a named reason, and the report lists
 * each skip. A key that appears in neither table fails the run ("unclassified"), so a new scenario cannot
 * slip past unchecked.
 */

/** Step kinds the runner executes: runs through the simulation server (core.plan), `compile` through template.merge and compile. */
export const EXECUTED_KINDS = ['run', 'batch', 'replay', 'replay_refused', 'compile'] as const;

/** Step kinds it does not execute yet, with the layer that owns them. */
export const SKIPPED_KINDS: Readonly<Record<string, string>> = {
  advance: 'timers fire on the server only (docs/07); no timer engine in core yet',
  import: 'the import layer (CRS detection, provenance) is not built yet',
  export: 'the export layer is not built yet',
  upgrade: 'template upgrade runs are a later work package (deploy path)',
  publish: 'template publishing is a later work package (deploy path)',
  view: 'views and clipped queries are a server-side layer (later work package)',
  app_profile: 'role app profiles are a later work package (H3)',
  resolve: 'localized-string resolution has no core API yet',
  explain: 'explanation text is asserted in plan tests; the runner has no comparison for it yet',
};

/** Step kinds that change stored state: skipping one means the final state cannot be asserted. */
export const STATE_CHANGING_KINDS: ReadonlySet<string> = new Set(['advance', 'import', 'upgrade']);

/** `then.<key>` at scenario level. `true` means the runner asserts it. */
export const THEN_KEYS: Readonly<Record<string, true | string>> = {
  steps: true,
  features: true,
  edges: true,
  edges_absent: true,
  ledger: true,
  timers_end: 'timers are not modelled (server-only, docs/07)',
  history_kept: 'history is asserted in the fold tests; the runner does not read capped history yet',
  history: 'history is asserted in the fold tests; the runner does not read capped history yet',
  effective: 'effective-config paths are asserted by the template tests',
  provenance: 'import provenance needs the import layer',
  blobs_referenced: 'blob use counts need the server blob store',
  ephemeral_views_persisted: 'views are not run',
  edge_updated_seq_bumped: 'per-edge seq is not stored by the fake store yet',
};

/** Per step kind, keys of the expected result. `true` means asserted. */
export const RESULT_KEYS: Readonly<Record<string, Readonly<Record<string, true | string>>>> = {
  run: {
    outcome: true,
    refusal: true,
    observations: true,
    observations_absent: true,
    no_trace: true,
    same_run_and_seq_range: true,
    one_transaction: true,
    field: 'the refusal path is not compared yet (Refusal.path is optional)',
    message: 'refusal message text is not compared',
    reason: 'explanations are asserted in plan tests',
    property: 'the refusal path is not compared yet',
    rule_runs: 'rule-run trees (depth, caused_by) are asserted in plan tests',
    depth_reached: 'rule-run trees are asserted in plan tests',
    dropped_fields: 'form value pruning is asserted in form tests',
    form_values: 'form values are asserted in form tests',
    timers_after: 'timers are not modelled (server-only)',
    edges_added: 'per-run edge deltas are not reported by the fake store yet',
    edges_removed: 'per-run edge deltas are not reported by the fake store yet',
    recorded_config_version: 'config versions per run are a server concern (WP-104)',
  },
  batch: {
    outcome: true,
    refusal: true,
    failed_item: true,
    item_refusal: true,
    accepted_items: true,
    refused_items: true,
    no_trace: true,
    seq_contiguous: true,
    one_transaction: true,
    runs_accepted: true,
    doorbell_rung: 'the realtime doorbell is an adapter concern (Phase 2)',
  },
  replay: { outcome: true, same_result_as: true, new_observations: true },
  replay_refused: { outcome: true, refusal: true, no_trace: true, new_observations: true },
  compile: { outcome: true, problems: true, nothing_deployed: true, resolved_template: true, origin: true, absent: true },
};

export const isChecked = (kind: string, key: string): boolean => RESULT_KEYS[kind]?.[key] === true;
