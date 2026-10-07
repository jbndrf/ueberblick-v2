import { compile } from '@ueberblick/core/compile';
import type { CompiledConfig } from '@ueberblick/core/model';
import type { EvalContext } from '@ueberblick/core/expr';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId, Key } from '@ueberblick/core/model';
import { TemplateFileSchema, type JsonValue } from '@ueberblick/core/schema';
import type { BuildFormInput, SessionOptions } from './contract';
import { goldenAssets } from '@ueberblick/core/testing';

export const TEST_TASK = 'aufgabe' as Key;
const TEST_TYPE = 'objekt' as Key;
const FEATURE = 'f1' as FeatureId;

/** A one-task project for form tests: the form and properties compile like any project file. */
export function formWorld(
  input: BuildFormInput,
  task: Key = TEST_TASK,
): { config: CompiledConfig; task: Key } {
  const file = {
    schema: 'ueberblick/1',
    template: { key: 'formtest', version: '1.0.0' },
    roles: { kontrolle: { label: { de: 'Kontrolle' } } },
    types: { [TEST_TYPE]: { label: { de: 'Objekt' }, properties: input.properties } },
    tasks: { [task]: { label: { de: 'Aufgabe' }, on: TEST_TYPE, form: input.form } },
  };
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(`test form does not compile: ${JSON.stringify(r.problems)}`);
  return { config: r.config, task };
}

/** An eval context with `self` holding the given properties and an actor. */
export function evalContext(
  config: CompiledConfig,
  self: Readonly<Record<string, JsonValue>> = {},
): EvalContext {
  return {
    vars: new Map<string, JsonValue | { $feature: FeatureId }>([
      ['self', { $feature: FEATURE }],
      ['actor', { id: 'u1', role: 'kontrolle', roles: ['kontrolle'] }],
    ]),
    features: {
      property: (f, k) => (f === FEATURE ? self[k] : undefined),
      related: () => [],
      history: () => [],
      type: () => TEST_TYPE,
    },
    now: '2026-09-29T12:00:00.000Z',
    relations: config.relations,
    geo: createGeo(),
  };
}

/** Session options over a compiled test form. */
export function sessionOptions(
  input: BuildFormInput,
  self: Readonly<Record<string, JsonValue>> = {},
  extra: Partial<SessionOptions> = {},
  taskKey: Key = TEST_TASK,
): SessionOptions {
  const { config, task } = formWorld(input, taskKey);
  return { task, config, ctx: evalContext(config, self), ...extra };
}
