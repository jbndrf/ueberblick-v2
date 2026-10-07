import { describe, expect, expectTypeOf, it } from 'vitest';
import fc from 'fast-check';
import { PRODUCIBLE_SHAPES, TOOL_API_VERSION, TOOL_CONTRIBUTIONS, ToolHostError } from './contract';
import { defineTool } from './define';

const mount = () => ({ destroy() {} });
const untyped = defineTool as unknown as (spec: Record<string, unknown>) => unknown;

function codeOf(spec: Record<string, unknown>): unknown {
  try {
    untyped(spec);
  } catch (e) {
    return e instanceof ToolHostError ? e.code : e;
  }
  return 'no error';
}

describe('defineTool', () => {
  it('returns a frozen tool stamped with API version 2', () => {
    expect(TOOL_API_VERSION).toBe(3);
    const tool = defineTool({ key: 'p', contributes: ['form-field'], produces: 'file', mount });
    expect(tool).toMatchObject({ key: 'p', contributes: ['form-field'], produces: 'file', api: 3 });
    expect(Object.isFrozen(tool)).toBe(true);
    expect(
      defineTool({ key: 'b', contributes: ['tools-sheet', 'feature-action'], mount }).contributes,
    ).toEqual(['tools-sheet', 'feature-action']);
  });

  it('keeps settings and preferences schemas', () => {
    const tool = defineTool({
      key: 'b',
      contributes: ['tools-sheet'],
      settings: { sources: { type: 'string_list' } },
      preferences: { unit: { type: 'select', options: ['m', 'ft'], default: 'm' } },
      mount,
    });
    expect(tool.settings?.sources?.type).toBe('string_list');
    expect(tool.preferences?.unit?.default).toBe('m');
  });

  it('types keep the contracts apart: a form-field tool produces, a panel tool has no produce', () => {
    defineTool({
      key: 'p',
      contributes: ['form-field'],
      produces: 'geometry',
      mount(_el, ctx) {
        expectTypeOf(ctx.produce).toBeFunction();
        expectTypeOf(ctx.clear).toEqualTypeOf<() => void>();
        expectTypeOf(ctx.setPreference).toBeFunction();
        // @ts-expect-error a form-field tool has no map
        void ctx.map;
        return mount();
      },
    });
    defineTool({
      key: 'b',
      contributes: ['tools-sheet'],
      mount(_el, ctx) {
        expectTypeOf(ctx.map.onTap).toBeFunction();
        // @ts-expect-error a panel tool never produces a value
        void ctx.produce;
        return mount();
      },
    });
    // Type errors only; never run (the runtime guard has its own test).
    void (() => {
      // @ts-expect-error `produces` must be a producible property type
      defineTool({ key: 'p', contributes: ['form-field'], produces: 'text', mount });
      // @ts-expect-error a panel tool declares no `produces`
      defineTool({ key: 'b', contributes: ['tools-sheet'], produces: 'file', mount });
      // @ts-expect-error `contributes` takes registry points only
      defineTool({ key: 'b', contributes: ['toolbar'], mount });
    });
  });

  it('the runtime guard refuses what types cannot (untyped callers)', () => {
    const field = { key: 'p', contributes: ['form-field'], produces: 'file', mount };
    expect(codeOf({ ...field, produces: 'text' })).toBe('invalid_definition');
    expect(codeOf({ key: 'p', contributes: ['form-field'], mount })).toBe('invalid_definition');
    expect(codeOf({ key: 'b', contributes: ['tools-sheet'], produces: 'file', mount })).toBe(
      'invalid_definition',
    );
    expect(codeOf({ key: 'b', contributes: ['viewer'], mount })).toBe('invalid_definition');
    expect(codeOf({ key: 'b', contributes: [], mount })).toBe('invalid_definition');
    expect(codeOf({ key: 'b', contributes: ['tools-sheet', 'tools-sheet'], mount })).toBe(
      'invalid_definition',
    );
    expect(codeOf({ ...field, contributes: ['form-field', 'tools-sheet'] })).toBe('invalid_definition');
    expect(codeOf({ key: '', contributes: ['tools-sheet'], mount })).toBe('invalid_definition');
    expect(codeOf({ key: 'b', contributes: ['tools-sheet'] })).toBe('invalid_definition');
  });

  it('refuses a broken settings or preferences schema', () => {
    const base = { key: 'b', contributes: ['tools-sheet'], mount };
    expect(codeOf({ ...base, settings: { a: { type: 'colour' } } })).toBe('invalid_definition');
    expect(codeOf({ ...base, preferences: { a: { type: 'select' } } })).toBe('invalid_definition');
    expect(codeOf({ ...base, preferences: { a: { type: 'integer', default: 'x' } } })).toBe(
      'invalid_definition',
    );
    expect(codeOf({ ...base, settings: [] })).toBe('invalid_definition');
  });

  it('property: a produced type outside PRODUCIBLE_SHAPES is always refused', () => {
    fc.assert(
      fc.property(fc.string(), (produces) => {
        fc.pre(!Object.hasOwn(PRODUCIBLE_SHAPES, produces));
        expect(codeOf({ key: 'p', contributes: ['form-field'], produces, mount })).toBe('invalid_definition');
      }),
    );
  });

  it('property: a contribution point outside the registry is always refused', () => {
    fc.assert(
      fc.property(fc.string(), (point) => {
        fc.pre(!TOOL_CONTRIBUTIONS.has(point));
        expect(codeOf({ key: 'b', contributes: [point], mount })).toBe('invalid_definition');
      }),
    );
  });
});
