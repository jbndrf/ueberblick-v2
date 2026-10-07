// WP-534.1: the `redact` then-step in the task schema and in compile.
import { describe, expect, it } from 'vitest';
import { THEN_STEP_KINDS } from '../registry';
import { compile } from './compile';
import { TemplateFileSchema } from './file';
import { ThenStepSchema } from './task';
import { erasureFile } from '../plan/__fixtures__/erasure';
import { goldenAssets } from '../testing/golden';

const step = (s: unknown) => ThenStepSchema.safeParse(s);

/** The erasure fixture with one task's `then` replaced. */
function withThen(then: unknown): unknown {
  const file = structuredClone(erasureFile()) as { tasks: Record<string, { then?: unknown }> };
  (file.tasks['erase_subject'] as { then?: unknown }).then = then;
  return file;
}

describe('then step kinds', () => {
  it('are a registry: set, redact and lifecycle', () => {
    expect(THEN_STEP_KINDS.keys).toEqual(['set', 'redact', 'lifecycle']);
  });

  it('accept a set step and a redact step, not both in one step', () => {
    expect(step({ set: { a: '1' } }).success).toBe(true);
    expect(step({ redact: { subject: 'actor', of: 'form.subject' } }).success).toBe(true);
    expect(step({ redact: { subject: 'feature' } }).success).toBe(true);
    expect(step({ set: { a: '1' }, redact: { subject: 'feature' } }).success).toBe(false);
    expect(step({ redact: { subject: 'feature' }, when: 'true' }).success).toBe(true);
  });

  it('a step has exactly one kind key: {}, a condition alone and an empty set are errors', () => {
    for (const bad of [{}, { when: 'true' }, { set: {} }, { otherwise: true }, { set: {}, when: 'true' }]) {
      expect(step(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('a redact step names its subject by a registry kind', () => {
    for (const subject of ['nobody', 'property:', 'actor:x', '']) {
      expect(step({ redact: { subject, of: 'form.x' } }).success, subject).toBe(false);
    }
  });

  it('an actor or property subject needs `of`; a feature subject may omit it', () => {
    expect(step({ redact: { subject: 'actor' } }).success).toBe(false);
    expect(step({ redact: { subject: 'property:melder' } }).success).toBe(false);
    expect(step({ redact: { subject: 'feature' } }).success).toBe(true);
  });
});

describe('redact in compile', () => {
  it('the fixture compiles', () => {
    const r = compile(TemplateFileSchema.parse(erasureFile()), { assets: goldenAssets });
    expect(r.ok).toBe(true);
  });

  it('an unknown subject kind is an error with its path', () => {
    const r = TemplateFileSchema.safeParse(withThen([{ redact: { subject: 'nobody', of: 'form.subject' } }]));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join('.'))).toContain(
      'tasks.erase_subject.then.0.redact.subject',
    );
  });

  it('an `of` that reads an unknown name is a compile problem at its path', () => {
    const r = compile(
      TemplateFileSchema.parse(withThen([{ redact: { subject: 'actor', of: 'form.missing_field' } }])),
      { assets: goldenAssets },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.some((p) => p.path === 'tasks.erase_subject.then["0"].redact.of')).toBe(true);
  });

  it('a property subject must name a participant property with personal values of that subject', () => {
    const r = compile(
      TemplateFileSchema.parse(withThen([{ redact: { subject: 'property:nothing', of: 'form.subject' } }])),
      { assets: goldenAssets },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.some((p) => p.path === 'tasks.erase_subject.then["0"].redact.subject')).toBe(true);
  });
});
