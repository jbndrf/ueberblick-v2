// WP-371 / WP-374 (A-035): a `set` step with `of` writes other features, so it is never a stage move of the subject.
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { deriveProcesses } from './graph';
import { goldenDoc, must } from './fixtures';

const file = (): TemplateFile => goldenDoc('baumkataster', '2.0.0').effective();
const withStep = (step: Record<string, unknown>): TemplateFile => {
  const f = file();
  const task = must(f.tasks?.['kontrolle']);
  return {
    ...f,
    tasks: { ...f.tasks, kontrolle: { ...task, then: [...(task.then ?? []), step as never] } },
  };
};
const process = (f: TemplateFile) => must(deriveProcesses(f, 'baum')[0]);

describe('process graph and the `of` of a then-step', () => {
  it('a set of the stage property with `of` draws no arrow', () => {
    const withOf = process(withStep({ set: { stage: "'erledigt'" }, of: 'self.massnahmen' }));
    expect(withOf.edges).toEqual(process(file()).edges);
  });

  it('the same step without `of` is an arrow to the option', () => {
    const base = process(file());
    const plain = process(withStep({ set: { stage: "'erledigt'" } }));
    expect(plain.edges.length).toBe(base.edges.length + 1);
    expect(plain.edges.at(-1)).toMatchObject({ key: 'kontrolle', to: 'erledigt' });
  });

  it('a computed value with `of` is not reported as a computed move either', () => {
    const p = process(withStep({ set: { stage: 'form.x' }, of: 'self.massnahmen' }));
    expect(p.computed).toEqual(process(file()).computed);
  });
});
