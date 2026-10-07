/**
 * Automatic action cycles. An action `after: A` on task B is an edge A -> B, because running B triggers the actions
 * `after: B`. A cycle of unconditional actions never ends (error). A cycle in which some entry has a
 * `when` may be bounded by that condition and by the plan's depth limit, so it is a warning.
 */
import type { TemplateFile } from '../file';
import { listAutos, splitAutoId } from './autos';
import { kp } from './kp';
import type { Sink } from './problems';

interface Edge {
  readonly rule: string;
  readonly from: string;
  readonly to: string;
  readonly conditional: boolean;
}

/** Strongly connected components with a cycle (size > 1, or a self-loop), by Tarjan. */
function cyclicComponents(nodes: readonly string[], edges: readonly Edge[]): string[][] {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const result: string[][] = [];
  let counter = 0;
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    on.add(v);
    for (const w of out.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop() as string;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      const selfLoop = edges.some((e) => e.from === v && e.to === v);
      if (comp.length > 1 || selfLoop) result.push(comp.sort());
    }
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return result;
}

export function checkRuleCycles(file: TemplateFile, sink: Sink): void {
  const tasks = Object.keys(file.tasks ?? {});
  const edges: Edge[] = [];
  for (const a of listAutos(file)) {
    if (a.kind !== 'after' || !tasks.includes(a.entry.after as string)) continue; // dangling is reported elsewhere
    edges.push({
      rule: a.id,
      from: a.entry.after as string,
      to: a.task,
      conditional: a.entry.when !== undefined,
    });
  }
  const within = (comp: readonly string[], list: readonly Edge[]): string[] =>
    [...new Set(list.filter((e) => comp.includes(e.from) && comp.includes(e.to)).map((e) => e.rule))].sort();
  const at = (id: string): string => {
    const { task, name } = splitAutoId(id);
    return kp('tasks', task, 'auto', name);
  };

  const hard = cyclicComponents(
    tasks,
    edges.filter((e) => !e.conditional),
  );
  const inHard = new Set(hard.flat());
  for (const comp of hard) {
    const rules = within(
      comp,
      edges.filter((e) => !e.conditional),
    );
    sink.error(
      at(rules[0] as string),
      'rule_cycle',
      `automatic actions ${rules.join(', ')} trigger each other forever (tasks ${comp.join(' -> ')})`,
      `add a \`when\` to one of ${rules.join(', ')} that stops the chain, or remove one of them`,
      { rules: rules.join(', '), tasks: comp.join(' -> ') },
    );
  }
  for (const comp of cyclicComponents(tasks, edges)) {
    if (comp.every((t) => inHard.has(t))) continue;
    const rules = within(comp, edges);
    sink.warn(
      at(rules[0] as string),
      'rule_cycle',
      `automatic actions ${rules.join(', ')} can trigger each other; only their conditions stop the chain`,
      'make sure the `when` of one of these automatic actions turns false after a run, otherwise the depth limit refuses the run',
      { variant: 'conditional', rules: rules.join(', '), tasks: comp.join(' -> ') },
    );
  }
}
