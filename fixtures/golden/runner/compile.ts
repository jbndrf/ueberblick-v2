/**
 * Executing `compile` steps (WP-542). The project goes through core's `template.merge`, then
 * `problemsFromMergeIssues` (merge issues, in merge order) or `compile` (when the merge is clean). The runner
 * re-implements neither (R1); it only finds the template file and compares the result with the scenario.
 */
import { compile, problemsFromMergeIssues, type Problem } from '../../../packages/core/src/schema/compile';
import { OverlayFileSchema, TemplateFileSchema } from '../../../packages/core/src/schema/file';
import { merge } from '../../../packages/core/src/template';
import { getAt } from '../../../packages/core/src/template/paths';
import { goldenAssets, goldenYaml, newestTemplate } from '../../../packages/core/src/testing';
import { isRec, type Rec } from './match';
import type { ScenarioDoc } from './world';

interface CompileOutcome {
  readonly ok: boolean;
  readonly resolved: string;
  readonly problems: readonly Problem[];
  readonly file: unknown;
  readonly origin: (path: string) => string | undefined;
}

function compileProject(path: string): CompileOutcome {
  const overlay = OverlayFileSchema.parse(goldenYaml(path));
  const [name = '', major = ''] = overlay.extends.split('@');
  const template = newestTemplate(name, major);
  const m = merge(template, overlay);
  const resolved = `${template.template.key}@${template.template.version}`;
  const origin = (p: string): string | undefined =>
    m.provenance.get(p) ?? (getAt(m.file, p) !== undefined ? 'template' : undefined);
  if (m.issues.length > 0) return { ok: false, resolved, problems: problemsFromMergeIssues(m.issues), file: m.file, origin };
  const r = compile(TemplateFileSchema.parse(m.file), { assets: goldenAssets });
  return { ok: r.ok, resolved, problems: r.ok ? [] : r.problems, file: m.file, origin };
}

/** Runs one compile step and returns the failures against `want`. */
export function runCompileStep(doc: ScenarioDoc, step: Rec, want: Rec): string[] {
  const id = String(step['id']);
  const path = String(step['project'] ?? doc.given['project'] ?? doc.given['template']);
  const got = compileProject(path);
  const fail: string[] = [];
  const at = (m: string): void => void fail.push(`${id}: ${m}`);
  const outcome = got.ok ? 'accepted' : 'failed';
  for (const [key, val] of Object.entries(want)) {
    switch (key) {
      case 'outcome':
        if (outcome !== val) at(`outcome ${outcome}, expected ${String(val)}`);
        break;
      case 'nothing_deployed':
        if (val === true && got.ok) at('nothing_deployed: the project compiled, so it would deploy');
        break;
      case 'resolved_template':
        if (got.resolved !== val) at(`resolved_template ${got.resolved}, expected ${String(val)}`);
        break;
      case 'problems':
        fail.push(...checkProblems(id, val as Rec[], got.problems));
        break;
      case 'origin':
        for (const [p, o] of Object.entries(val as Rec)) {
          if (got.origin(p) !== o) at(`origin of ${p} is ${String(got.origin(p))}, expected ${String(o)}`);
        }
        break;
      case 'absent':
        for (const p of val as string[]) if (getAt(got.file, p) !== undefined) at(`absent: ${p} exists in the effective config`);
        break;
    }
  }
  return fail;
}

/** Exact list, in merge order: code, path and message always, the core hint when the scenario names one. */
function checkProblems(id: string, want: readonly Rec[], got: readonly Problem[]): string[] {
  const fail: string[] = [];
  if (got.length !== want.length) {
    fail.push(`${id}: ${got.length} problems, expected ${want.length}: ${JSON.stringify(got.map((p) => [p.code, p.path]))}`);
  }
  want.forEach((w, i) => {
    const p = got[i];
    if (!p) return;
    const diffs = [
      ['code', w['problem'], p.code],
      ['path', w['path'], p.path],
      ['message', w['message'], p.message],
      ...('hint' in w ? [['hint', w['hint'], p.hint]] : []),
    ].filter(([, a, b]) => a !== b);
    if (diffs.length > 0) {
      fail.push(`${id}: problem ${i + 1} differs (${diffs.map(([k, a, b]) => `${String(k)} expected ${String(a)}, got ${String(b)}`).join('; ')})`);
    }
  });
  return fail;
}

/** Whether every step of a scenario is a compile step (its project may be meant to fail merging). */
export const onlyCompile = (doc: ScenarioDoc): boolean => doc.when.every((s) => isRec(s) && s['kind'] === 'compile');
