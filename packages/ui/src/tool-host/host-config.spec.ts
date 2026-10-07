// @vitest-environment jsdom
// WP-613: availability gate, contribution points, effective settings and preferences in the host.
import { describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '@ueberblick/core/model';
import {
  type PanelPoint,
  type PanelToolContext,
  type ToolAvailability,
  type ToolPersonPort,
} from './contract';
import { defineTool } from './define';
import { createToolHost } from './host';
import { testMap, testPorts } from './testing';

type Obj = Readonly<Record<string, JsonValue>>;

interface Setup {
  availability?: ToolAvailability;
  switchOf?: boolean;
  project?: Obj;
  role?: Obj;
  personal?: Obj;
}

function port(setup: Setup) {
  const personal: Record<string, JsonValue> = { ...setup.personal };
  const set = vi.fn((_tool: string, key: string, value: JsonValue) => void (personal[key] = value));
  const config: ToolPersonPort = {
    availability: () => setup.availability,
    settings: () => ({
      ...(setup.project && { project: setup.project }),
      ...(setup.role && { role: setup.role }),
    }),
    switchOf: () => setup.switchOf,
    preferencesOf: () => personal,
    setPreference: set,
  };
  return { config, set };
}

const search = (onMount: (ctx: PanelToolContext) => void = () => {}) =>
  defineTool({
    key: 'search',
    contributes: ['tools-sheet', 'feature-action'],
    settings: { sources: { type: 'string_list' }, limit: { type: 'integer', min: 1, default: 20 } },
    preferences: {
      unit: { type: 'select', options: ['m', 'ft'], default: 'm' },
      limit: { type: 'integer', min: 1 },
    },
    mount(_el, ctx) {
      onMount(ctx);
      return { destroy: () => {} };
    },
  });

const mountAt = (
  setup: Setup,
  point: PanelPoint = 'tools-sheet',
  onMount?: (ctx: PanelToolContext) => void,
) => {
  const p = port(setup);
  const host = createToolHost({
    loaders: { search: async () => search(onMount) },
    ports: testPorts(),
    person: p.config,
  });
  const mount = () =>
    host.mountPanel(document.createElement('div'), {
      toolKey: 'search',
      point,
      startTask: vi.fn(),
      map: testMap(),
      openFeature: vi.fn(),
      searchText: () => [],
      feature: () => undefined,
      typeLabel: (k) => k,
    });
  return { mount, ...p };
};

describe('availability', () => {
  it('an offered tool is off by default and on once the person switches it on', async () => {
    await expect(mountAt({ availability: 'offered' }).mount()).rejects.toMatchObject({ code: 'tool_off' });
    await expect(mountAt({ availability: 'offered', switchOf: true }).mount()).resolves.toBeDefined();
  });
  it('an active tool is on by default and off once the person switches it off', async () => {
    await expect(mountAt({ availability: 'active' }).mount()).resolves.toBeDefined();
    await expect(mountAt({ availability: 'active', switchOf: false }).mount()).rejects.toMatchObject({
      code: 'tool_off',
    });
  });
  it('a tool the role does not list is never mounted, even when the person switched it on', async () => {
    await expect(mountAt({ switchOf: true }).mount()).rejects.toMatchObject({ code: 'tool_off' });
  });
});

describe('contribution points', () => {
  it('a tool mounts only at the points it declares', async () => {
    await expect(mountAt({ availability: 'active' }, 'tools-sheet').mount()).resolves.toBeDefined();
    await expect(mountAt({ availability: 'active' }, 'feature-action').mount()).resolves.toBeDefined();
    for (const point of ['filter-tab', 'layer-section', 'settings-section'] as const)
      await expect(mountAt({ availability: 'active' }, point).mount()).rejects.toMatchObject({
        code: 'wrong_point',
      });
  });
  it('tells the tool where it was mounted', async () => {
    let seen: PanelToolContext | undefined;
    await mountAt({ availability: 'active' }, 'feature-action', (c) => (seen = c)).mount();
    expect(seen?.point).toBe('feature-action');
  });
});

describe('settings and preferences in the context', () => {
  it('settings = defaults, project, role; a person cannot change them', async () => {
    let seen: PanelToolContext | undefined;
    await mountAt(
      {
        availability: 'active',
        project: { sources: ['a.b'], limit: 5 },
        role: { limit: 7 },
        personal: { sources: ['x.y'] },
      },
      'tools-sheet',
      (c) => (seen = c),
    ).mount();
    expect(seen?.settings).toEqual({ sources: ['a.b'], limit: 7 });
  });
  it('preferences = defaults, admin default, then the person; only preference keys', async () => {
    let seen: PanelToolContext | undefined;
    await mountAt(
      { availability: 'active', role: { limit: 7, sources: ['a.b'] }, personal: { unit: 'ft' } },
      'tools-sheet',
      (c) => (seen = c),
    ).mount();
    expect(seen?.preferences).toEqual({ unit: 'ft', limit: 7 });
  });
  it('setPreference stores a valid value and the next read sees it', async () => {
    let seen: PanelToolContext | undefined;
    const t = mountAt({ availability: 'active' }, 'tools-sheet', (c) => (seen = c));
    await t.mount();
    expect(seen?.preferences.unit).toBe('m');
    seen?.setPreference('unit', 'ft');
    expect(t.set).toHaveBeenCalledWith('search', 'unit', 'ft');
    expect(seen?.preferences.unit).toBe('ft');
  });
  it('setPreference refuses an unknown key, a settings-only key and a wrong value', async () => {
    let seen: PanelToolContext | undefined;
    const t = mountAt({ availability: 'active' }, 'tools-sheet', (c) => (seen = c));
    await t.mount();
    for (const [k, v] of [
      ['nope', 1],
      ['sources', ['a.b']],
      ['unit', 'km'],
      ['limit', 0],
    ] as const)
      expect(() => seen?.setPreference(k, v as JsonValue)).toThrowError(
        expect.objectContaining({ code: 'invalid_preference' }),
      );
    expect(t.set).not.toHaveBeenCalled();
  });
  it('setPreference after unmount is refused', async () => {
    let seen: PanelToolContext | undefined;
    const t = mountAt({ availability: 'active' }, 'tools-sheet', (c) => (seen = c));
    (await t.mount()).destroy();
    expect(() => seen?.setPreference('unit', 'ft')).toThrowError(
      expect.objectContaining({ code: 'unmounted' }),
    );
  });
  it('without a config port: schema defaults, no gate, no preference store', async () => {
    let seen: PanelToolContext | undefined;
    const host = createToolHost({
      loaders: { search: async () => search((c) => (seen = c)) },
      ports: testPorts(),
    });
    await host.mountPanel(document.createElement('div'), {
      toolKey: 'search',
      point: 'tools-sheet',
      startTask: vi.fn(),
      map: testMap(),
      openFeature: vi.fn(),
      searchText: () => [],
      feature: () => undefined,
      typeLabel: (k) => k,
    });
    expect(seen?.settings).toEqual({ limit: 20 });
    expect(() => seen?.setPreference('unit', 'ft')).toThrowError(
      expect.objectContaining({ code: 'invalid_preference' }),
    );
  });
});
