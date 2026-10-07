// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ToolHostError,
  type FieldToolContext,
  type FieldTool,
  type Tool,
  type ToolField,
  type PanelToolContext,
} from './contract';
import { defineTool } from './define';
import { testMap, testPorts } from './testing';
import type { FeatureId, Key } from '@ueberblick/core/model';
import { createToolHost, webCryptoHash } from './host';

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}

const ports = testPorts();
const field: ToolField = { key: 'foto', id: 'f-foto', label: 'Photo', type: 'file' };
const SHA = 'a'.repeat(64);

function fieldTool(onMount: (ctx: FieldToolContext) => void = () => {}): FieldTool {
  return defineTool({
    contributes: ['form-field'],
    key: 'fake',
    produces: 'file',
    mount(_el, ctx) {
      onMount(ctx);
      return { destroy: () => {} };
    },
  });
}

const host = (loaders: Record<string, () => Promise<Tool>>) => createToolHost({ loaders, ports });
const input = (toolKey: string, onproduce = vi.fn(), onclear = vi.fn()) => ({
  toolKey,
  field,
  value: undefined,
  onproduce,
  onclear,
});
const div = () => document.createElement('div');

describe('tool host', () => {
  it('mounts a tool by key, lazily, and loads it once', async () => {
    const loader = vi.fn(async () => fieldTool());
    const h = host({ fake: loader });
    expect(loader).not.toHaveBeenCalled();
    await h.mountField(div(), input('fake'));
    await h.mountField(div(), input('fake'));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('an unknown tool key is a typed error', async () => {
    const err = await host({})
      .mountField(div(), input('nope'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolHostError);
    expect(err).toMatchObject({ code: 'unknown_tool', toolKey: 'nope' });
    const proto = await host({})
      .mountField(div(), input('toString'))
      .catch((e: unknown) => e);
    expect(proto).toMatchObject({ code: 'unknown_tool' });
  });

  it('a tool for another property type is refused', async () => {
    const h = host({ fake: async () => fieldTool() });
    const err = await h
      .mountField(div(), { ...input('fake'), field: { ...field, type: 'text' } })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'wrong_field_type' });
  });

  it('a field tool sees only its own field and can only call produce', async () => {
    let ctx: FieldToolContext | undefined;
    const onproduce = vi.fn();
    await host({ fake: async () => fieldTool((c) => (ctx = c)) }).mountField(div(), input('fake', onproduce));
    expect(Object.keys(must(ctx)).sort()).toEqual([
      'clear',
      'field',
      'locale',
      'options',
      'ports',
      'preferences',
      'produce',
      'setPreference',
      'settings',
      'value',
    ]);
    expect(Object.keys(must(ctx).ports).sort()).toEqual(['blobs', 'hash', 'position']);
    must(ctx).produce([{ sha256: SHA, name: 'a.jpg', mime: 'image/jpeg' }]);
    expect(onproduce).toHaveBeenCalledWith([{ sha256: SHA, name: 'a.jpg', mime: 'image/jpeg' }]);
  });

  it('a value of the wrong shape is refused, and nothing is produced after destroy', async () => {
    let ctx: FieldToolContext | undefined;
    const onproduce = vi.fn();
    const handle = await host({ fake: async () => fieldTool((c) => (ctx = c)) }).mountField(
      div(),
      input('fake', onproduce),
    );
    expect(() => must(ctx).produce('x')).toThrowError(expect.objectContaining({ code: 'invalid_value' }));
    expect(() => must(ctx).produce([{ sha256: 'short', name: 'a', mime: 'b' }])).toThrow(ToolHostError);
    expect(onproduce).not.toHaveBeenCalled();
    handle.destroy();
    expect(() => must(ctx).produce({ sha256: SHA, name: 'a', mime: 'b' })).toThrowError(
      expect.objectContaining({ code: 'unmounted' }),
    );
  });

  it('panel tools get the map, openFeature, searchText and feature ports; a field tool cannot mount there', async () => {
    let seen: PanelToolContext | undefined;
    const h = host({
      bar: async () =>
        defineTool({
          contributes: ['tools-sheet'],
          key: 'bar',
          mount(_el, ctx) {
            seen = ctx;
            return { destroy: () => {} };
          },
        }),
      fake: async () => fieldTool(),
    });
    const startTask = vi.fn();
    const map = testMap();
    const openFeature = vi.fn();
    const searchText = vi.fn(() => ['f1' as FeatureId]);
    const feature = vi.fn();
    const input = {
      toolKey: 'bar',
      point: 'tools-sheet' as const,
      startTask,
      map,
      openFeature,
      searchText,
      feature,
      typeLabel: (k: Key) => `label of ${k}`,
    };
    await h.mountPanel(div(), input);
    const ctx = seen as PanelToolContext;
    expect(Object.keys(ctx).sort()).toEqual([
      'feature',
      'locale',
      'map',
      'openFeature',
      'point',
      'ports',
      'preferences',
      'searchText',
      'setPreference',
      'settings',
      'startTask',
      'typeLabel',
    ]);
    expect(ctx.typeLabel('tree' as Key)).toBe('label of tree');
    ctx.map.centerOn([13, 52]);
    ctx.openFeature('f1' as FeatureId);
    expect(map.centerOn).toHaveBeenCalledWith([13, 52]);
    expect(openFeature).toHaveBeenCalledWith('f1');
    expect(ctx.searchText([{ type: 'tree' as Key, property: 'name' }], 'a', 5)).toEqual(['f1']);
    const err = await h.mountPanel(div(), { ...input, toolKey: 'fake' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'wrong_point' });
  });

  it('passes per-field options and locale', async () => {
    let ctx: FieldToolContext | undefined;
    const h = createToolHost({
      loaders: { fake: async () => fieldTool((c) => (ctx = c)) },
      ports,
      locale: 'de',
      optionsFor: (t, f) => ({ tool: t, field: f }),
    });
    await h.mountField(div(), input('fake'));
    expect(ctx).toMatchObject({ locale: 'de', options: { tool: 'fake', field: 'foto' } });
  });

  it('a tool clears its field explicitly: a distinct call, never a null value', async () => {
    let ctx: FieldToolContext | undefined;
    const onproduce = vi.fn();
    const onclear = vi.fn();
    const handle = await host({ fake: async () => fieldTool((c) => (ctx = c)) }).mountField(
      div(),
      input('fake', onproduce, onclear),
    );
    expect(() => must(ctx).produce(null as never)).toThrowError(
      expect.objectContaining({ code: 'invalid_value' }),
    );
    must(ctx).clear();
    expect(onclear).toHaveBeenCalledTimes(1);
    expect(onproduce).not.toHaveBeenCalled();
    handle.destroy();
    expect(() => must(ctx).clear()).toThrowError(expect.objectContaining({ code: 'unmounted' }));
  });

  it('both kinds reach the position port through ctx.ports', async () => {
    const current = vi.fn(async () => ({ lon: 9, lat: 48 }));
    const h = createToolHost({
      loaders: {
        bar: async () =>
          defineTool({
            contributes: ['tools-sheet'],
            key: 'bar',
            mount(_el, ctx) {
              void ctx.ports.position.current();
              return { destroy: () => {} };
            },
          }),
        fake: async () => fieldTool((c) => void c.ports.position.current()),
      },
      ports: testPorts({ position: { current } }),
    });
    await h.mountField(div(), input('fake'));
    await h.mountPanel(div(), {
      toolKey: 'bar',
      point: 'tools-sheet',
      startTask: vi.fn(),
      map: testMap(),
      openFeature: vi.fn(),
      searchText: () => [],
      feature: () => undefined,
      typeLabel: (k) => k,
    });
    expect(current).toHaveBeenCalledTimes(2);
  });

  it('a loader that returns a hand-built or foreign-version tool is refused', async () => {
    const raw = {
      contributes: ['form-field'],
      key: 'fake',
      produces: 'file',
      mount: () => ({ destroy() {} }),
    };
    const a = await host({ fake: async () => raw as unknown as Tool })
      .mountField(div(), input('fake'))
      .catch((e: unknown) => e);
    expect(a).toMatchObject({ code: 'invalid_definition' });
    const b = await host({ fake: async () => ({ ...fieldTool(), api: 1 }) as unknown as Tool })
      .mountField(div(), input('fake'))
      .catch((e: unknown) => e);
    expect(b).toMatchObject({ code: 'unsupported_api' });
  });

  it('hashes with WebCrypto', async () => {
    const empty = await webCryptoHash.sha256(new ArrayBuffer(0));
    expect(empty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
