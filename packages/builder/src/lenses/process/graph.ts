/**
 * The process graph (docs/08 "Process"): of the declared process of a feature type, the options of its property are
 * nodes, a task whose `then` sets an option is an arrow, a rule that runs such a task is a dashed
 * arrow, and a task that does not change the property sits on the node it is available in.
 * A pure function of the effective file; nothing here is stored (the file stays the one truth).
 *
 * Where an arrow starts is read from `self.<property> == '<option>'` (or `in [...]`) among the
 * `&&` operands of the step's `when`, else of the task's `when`. No such condition: it starts
 * "anywhere" (`from: undefined`).
 */
import { TASK_OFFERS, listAutos, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import { parse, type Expr } from '@ueberblick/core/expr/compile';

/** What draws an arrow: a task step or a rule. */
export const EDGE_ORIGINS = { task: 'task', rule: 'rule' } as const;
export type EdgeOrigin = (typeof EDGE_ORIGINS)[keyof typeof EDGE_ORIGINS];

/** Why an arrow's source is not fixed although its task or step has a `when`. */
export const UNFIXED = { unparsed: 'unparsed', unpinned: 'unpinned' } as const;
export type Unfixed = (typeof UNFIXED)[keyof typeof UNFIXED];

export interface ProcessNode {
  readonly option: string;
  readonly label: LocalizedString;
  readonly isStart: boolean;
  /** Tasks that are available in this state and do not change the property. */
  readonly tasks: readonly string[];
}

export interface ProcessEdge {
  /** Unique within the process. */
  readonly id: string;
  readonly origin: EdgeOrigin;
  /** The task key (task arrow) or the rule key (rule arrow). */
  readonly key: string;
  /** For a rule arrow: the task it runs. */
  readonly task?: string;
  /** Source option; undefined: no condition names one (see `unfixed`). */
  readonly from?: string;
  /**
   * Set when `from` is undefined although a condition exists: it could not be read, or it does not
   * name a state of this property. The UI must not draw such an arrow as "from any state".
   */
  readonly unfixed?: Unfixed;
  /** The step is an `otherwise` step: it runs only when no earlier conditional step ran. */
  readonly otherwise?: true;
  readonly to: string;
  /** Position of the step in `tasks.<key>.then` (task arrows only). */
  readonly step?: number;
  /** The step's own condition as written, when it is not what fixes the source. */
  readonly when?: string;
}

export interface Process {
  readonly property: string;
  readonly label?: LocalizedString;
  readonly nodes: readonly ProcessNode[];
  readonly edges: readonly ProcessEdge[];
  /** Tasks with a step that sets the property to something computed (not one literal option). */
  readonly computed: readonly string[];
}

export type TaskDef = NonNullable<TemplateFile['tasks']>[string];
type Step = NonNullable<TaskDef['then']>[number];

const OFFERS: readonly string[] = TASK_OFFERS.keys;

/** True when the task is offered on features of `type`: `self` of its conditions is such a feature. */
export function taskOfferedOn(task: TaskDef, type: string): boolean {
  const on = Array.isArray(task.on) ? task.on : [task.on];
  return on.some((o) => !OFFERS.includes(o) && o === type);
}

/** True when the unprefixed keys of the task's `then` address features of `type` (`creates` says whose). */
export function taskChanges(task: TaskDef, type: string): boolean {
  return task.creates === undefined ? taskOfferedOn(task, type) : task.creates === type;
}

const stringLiteral = (e: Expr): string | undefined =>
  e.kind === 'literal' && e.type === 'string' ? String(e.value) : undefined;

const isSelfProperty = (e: Expr, property: string): boolean =>
  e.kind === 'member' && e.field === property && e.object.kind === 'ident' && e.object.name === 'self';

function conjuncts(e: Expr): Expr[] {
  return e.kind === 'binary' && e.op === '&&' ? [...conjuncts(e.left), ...conjuncts(e.right)] : [e];
}

/** The options a condition pins `self.<property>` to; undefined when it does not pin it. */
export function pinnedOptions(src: string | undefined, property: string): string[] | undefined {
  if (src === undefined) return undefined;
  const parsed = parse(src);
  if (!parsed.ok) return undefined;
  for (const c of conjuncts(parsed.ast)) {
    if (c.kind !== 'binary') continue;
    if (c.op === '==') {
      const [a, b] = isSelfProperty(c.left, property) ? [c.left, c.right] : [c.right, c.left];
      const v = isSelfProperty(a, property) ? stringLiteral(b) : undefined;
      if (v !== undefined) return [v];
    }
    if (c.op === 'in' && isSelfProperty(c.left, property) && c.right.kind === 'list') {
      const vs = c.right.elements.map(stringLiteral);
      if (vs.every((v): v is string => v !== undefined)) return vs;
    }
  }
  return undefined;
}

/** `'x'` (a quoted option key) to `x`; anything else is a computed value. */
export function literalOption(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = parse(value);
  return parsed.ok ? stringLiteral(parsed.ast) : undefined;
}

/** The reason for two conditions together: unreadable outranks "names no state". */
function worst(...reasons: (Unfixed | undefined)[]): Unfixed | undefined {
  return reasons.includes(UNFIXED.unparsed) ? UNFIXED.unparsed : reasons.find((r) => r !== undefined);
}

/** Why a condition that fixes no source does not: it does not parse, or it names no state. */
function unfixedReason(src: string | undefined): Unfixed | undefined {
  if (src === undefined) return undefined;
  return parse(src).ok ? UNFIXED.unpinned : UNFIXED.unparsed;
}

interface Resolved {
  readonly to: string;
  readonly from: readonly (string | undefined)[];
  readonly unfixed?: Unfixed;
}

function processFor(file: TemplateFile, type: string, property: string, start: string): Process {
  const prop = file.types?.[type]?.properties?.[property];
  const optionKeys = Object.keys(prop?.options ?? {});
  const options = new Set(optionKeys);
  const edges: ProcessEdge[] = [];
  const onNode = new Map<string, string[]>();
  const computed: string[] = [];
  const resolvedByTask = new Map<string, Resolved[]>();

  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const offered = taskOfferedOn(task, type);
    const changes = taskChanges(task, type);
    if (!offered && !changes) continue;
    // `self` of the conditions is the feature the task is offered on; only then can they pin its state.
    const pin = (src: string | undefined) => (offered ? pinnedOptions(src, property) : undefined);
    const taskFrom = pin(task.when);
    const resolved: Resolved[] = [];
    let sets = false;
    (task.then ?? []).forEach((step: Step, index) => {
      // A step with `of` writes the features `of` names (a relation's children), never the subject's own stage.
      if (!changes || step.of !== undefined || !(property in (step.set ?? {}))) return;
      sets = true;
      const to = literalOption(step.set?.[property]);
      if (to === undefined || !options.has(to)) {
        computed.push(key);
        return;
      }
      const stepFrom = pin(step.when);
      const from = stepFrom ?? taskFrom ?? [undefined];
      // A condition that exists but fixes no source: say so instead of "any state".
      const unfixed =
        from[0] === undefined ? worst(unfixedReason(step.when), unfixedReason(task.when)) : undefined;
      resolved.push({ to, from, ...(unfixed !== undefined ? { unfixed } : {}) });
      for (const f of from) {
        edges.push({
          id: `task:${key}:${index}:${f ?? '*'}`,
          origin: EDGE_ORIGINS.task,
          key,
          ...(f !== undefined ? { from: f } : {}),
          ...(unfixed !== undefined ? { unfixed } : {}),
          ...(step.otherwise === true ? { otherwise: true as const } : {}),
          to,
          step: index,
          ...(step.when !== undefined && stepFrom === undefined ? { when: step.when } : {}),
        });
      }
    });
    resolvedByTask.set(key, resolved);
    if (!sets)
      for (const f of taskFrom ?? []) if (options.has(f)) onNode.set(f, [...(onNode.get(f) ?? []), key]);
  }

  for (const auto of listAutos(file)) {
    const key = auto.id;
    const rule = { when: auto.entry.when, run: auto.task };
    const ruleFrom = pinnedOptions(rule.when, property);
    const seen = new Set<string>();
    const add = (to: string, from: readonly (string | undefined)[], inherited?: Unfixed) => {
      const start = ruleFrom ?? from;
      const unfixed =
        start[0] === undefined
          ? (unfixedReason(rule.when) ?? (from[0] === undefined ? inherited : undefined))
          : undefined;
      for (const f of start) {
        const id = `rule:${key}:${to}:${f ?? '*'}`;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push({
          id,
          origin: EDGE_ORIGINS.rule,
          key,
          task: rule.run,
          ...(f !== undefined ? { from: f } : {}),
          ...(unfixed !== undefined ? { unfixed } : {}),
          to,
        });
      }
    };
    for (const t of resolvedByTask.get(rule.run) ?? []) add(t.to, t.from, t.unfixed);
  }

  return {
    property,
    ...(prop?.label !== undefined ? { label: prop.label } : {}),
    nodes: optionKeys.map((option) => ({
      option,
      label: (prop?.options?.[option] ?? option) as LocalizedString,
      isStart: option === start,
      tasks: onNode.get(option) ?? [],
    })),
    edges,
    computed,
  };
}

/** The declared process of the feature type (`types.<t>.process`): 0 or 1 entries. A type without one has none. */
export function deriveProcesses(file: TemplateFile, type: string): readonly Process[] {
  const decl = file.types?.[type]?.process;
  return decl === undefined ? [] : [processFor(file, type, decl.property, decl.start)];
}
