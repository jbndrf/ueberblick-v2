// Test kit of the tool API (WP-553), imported as `@ueberblick/ui/tool-testing`; never by app code.
// `describeToolContract` is the contract suite every tool must pass: definition, mount, unmount,
// value shape, clear, silence after unmount and offline. A tool's own spec adds its specific behaviour.
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Position } from '@ueberblick/core/geo';
import type { JsonValue } from '@ueberblick/core/model';
import {
  PRODUCIBLE_SHAPES,
  TOOL_API_VERSION,
  isFieldTool,
  type FieldTool,
  type FieldToolContext,
  type MountPanelInput,
  type Tool,
  type PanelTool,
  type ToolValuesContext,
  type ToolField,
  type ToolMapPort,
  type ToolPorts,
} from './contract';
import { assertTool, defineTool } from './define';
import { createToolHost, webCryptoHash } from './host';

/** The map port of a test: `tap(position)` plays a tap on the map; every call is a spy. */
export function testMap(): ToolMapPort & { tap(position: Position): void; readonly taps: number } {
  const handlers = new Set<(position: Position) => void>();
  return {
    centerOn: vi.fn(),
    showOverlay: vi.fn(),
    clearOverlay: vi.fn(),
    onTap(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    tap: (position) => handlers.forEach((h) => h(position)),
    get taps() {
      return handlers.size;
    },
  };
}

/** Ports of a test. `position` rejects by default, like a device without a signal. */
export function testPorts(over: Partial<ToolPorts> = {}): ToolPorts {
  return {
    blobs: { put: async () => {} },
    hash: webCryptoHash,
    position: { current: () => Promise.reject(new Error('no position in this test')) },
    ...over,
  };
}

interface ToolContractBase {
  readonly name: string;
  readonly options?: Readonly<Record<string, JsonValue>>;
  readonly ports?: ToolPorts;
}

/** A `field` tool: `drive` is required, so the suite never passes without a produced value. */
export interface FieldToolContractCase extends ToolContractBase {
  /** A fresh tool under test (a real `defineTool` result). */
  readonly tool: () => FieldTool | Promise<FieldTool>;
  /** The field the tool is mounted on (its type is the tool's `produces`). */
  readonly field: ToolField;
  /** Uses the mounted tool once (taps, types, picks a file) so that it produces a value. The suite also
   * destroys the tool while a drive is in flight, so keep the first step synchronous. */
  readonly drive: (root: HTMLElement) => Promise<void>;
}

export interface PanelToolContractCase extends ToolContractBase {
  readonly tool: () => PanelTool | Promise<PanelTool>;
  /** Overrides of what the app passes per mount. */
  readonly panel?: Partial<Omit<MountPanelInput, 'toolKey'>>;
  /** Uses the mounted tool once (taps, types, clicks). */
  readonly drive?: (root: HTMLElement) => Promise<void>;
}

export type ToolContractCase = FieldToolContractCase | PanelToolContractCase;

const NETWORK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'] as const;
const settle = () => new Promise<void>((r) => setTimeout(r, 30));

export function describeToolContract(c: ToolContractCase): void {
  describe(`tool contract: ${c.name}`, () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      document.body.replaceChildren();
    });

    async function mount() {
      const defined = await c.tool();
      const produced: JsonValue[] = [];
      const cleared = vi.fn();
      const map = testMap();
      const startTask = vi.fn();
      const openFeature = vi.fn();
      // The suite keeps the context the host gave the tool, to call `clear()` and `produce` after unmount.
      let seen: FieldToolContext | undefined;
      let seenConfig: ToolValuesContext | undefined;
      const tool: Tool = isFieldTool(defined)
        ? defineTool({
            ...defined,
            mount: (el, ctx) => {
              seen = ctx;
              seenConfig = ctx;
              return defined.mount(el, ctx);
            },
          })
        : defineTool({
            ...defined,
            mount: (el, ctx) => {
              seenConfig = ctx;
              return defined.mount(el, ctx);
            },
          });
      const host = createToolHost({
        loaders: { under_test: async () => tool },
        ports: c.ports ?? testPorts(),
        optionsFor: () => c.options ?? {},
      });
      const root = document.createElement('div');
      document.body.append(root);
      const handle = isFieldTool(tool)
        ? await host.mountField(root, {
            toolKey: 'under_test',
            field: (c as FieldToolContractCase).field,
            value: undefined,
            onproduce: (v) => void produced.push(v),
            onclear: cleared,
          })
        : await host.mountPanel(root, {
            toolKey: 'under_test',
            point: tool.contributes[0] ?? 'tools-sheet',
            startTask,
            map,
            openFeature,
            searchText: () => [],
            feature: () => undefined,
            typeLabel: (k) => k,
            ...(c as PanelToolContractCase).panel,
          });
      return {
        tool,
        root,
        handle,
        produced,
        cleared,
        map,
        startTask,
        openFeature,
        ctx: () => seen,
        config: () => seenConfig,
      };
    }

    it('is made by defineTool for this API version', async () => {
      const tool = await c.tool();
      expect(() => assertTool(tool)).not.toThrow();
      expect(tool.api).toBe(TOOL_API_VERSION);
      expect(Object.isFrozen(tool)).toBe(true);
    });

    it('declares valid settings and preferences and gets the defaults in ctx', async () => {
      const { tool, config, handle } = await mount();
      const ctx = config();
      expect(ctx).toBeDefined();
      for (const [key, option] of Object.entries(tool.settings ?? {}))
        if (option.default !== undefined && !(c.options && key in c.options))
          expect(ctx?.settings[key]).toEqual(option.default);
      for (const [key, option] of Object.entries(tool.preferences ?? {}))
        if (option.default !== undefined) expect(ctx?.preferences[key]).toEqual(option.default);
      expect(() => ctx?.setPreference('__not_a_preference__', true)).toThrowError(
        expect.objectContaining({ code: 'invalid_preference' }),
      );
      handle.destroy();
    });

    it('mounts into its element and unmounts without a trace (twice is fine)', async () => {
      const { root, handle, map } = await mount();
      expect(root.childNodes.length).toBeGreaterThan(0);
      handle.destroy();
      expect(root.childNodes.length).toBe(0);
      expect(map.taps).toBe(0);
      expect(() => handle.destroy()).not.toThrow();
    });

    it('produces only values of its property type, or none for a panel tool', async () => {
      const { tool, root, produced, startTask } = await mount();
      await c.drive?.(root);
      if (isFieldTool(tool)) {
        expect(produced.length).toBeGreaterThan(0);
        for (const v of produced) expect(PRODUCIBLE_SHAPES[tool.produces](v)).toBe(true);
      } else {
        expect(produced).toEqual([]);
        expect(startTask.mock.calls.every(([key]) => typeof key === 'string')).toBe(true);
      }
    });

    it('a field tool clears its field with ctx.clear(), and cannot clear or produce after unmount', async () => {
      const { tool, ctx, cleared, produced, handle } = await mount();
      if (!isFieldTool(tool)) return;
      const live = ctx();
      expect(live).toBeDefined();
      live?.clear();
      expect(cleared).toHaveBeenCalledTimes(1);
      expect(produced).toEqual([]);
      handle.destroy();
      expect(() => live?.clear()).toThrowError(expect.objectContaining({ code: 'unmounted' }));
      expect(() => live?.produce({})).toThrowError(expect.objectContaining({ code: 'unmounted' }));
      expect(cleared).toHaveBeenCalledTimes(1);
    });

    it('nothing fires after unmount: no value, no task, no map call, no tap listener', async () => {
      const m = await mount();
      const running = Promise.resolve(c.drive?.(m.root)).catch(() => undefined);
      m.handle.destroy();
      const at = () => [
        m.produced.length,
        m.cleared.mock.calls.length,
        m.startTask.mock.calls.length,
        m.openFeature.mock.calls.length,
        vi.mocked(m.map.showOverlay).mock.calls.length,
        vi.mocked(m.map.centerOn).mock.calls.length,
      ];
      const before = at();
      await running;
      await settle();
      expect(at()).toEqual(before);
      expect(m.map.taps).toBe(0);
    });

    it('works offline: mounting and driving never touch the network', async () => {
      const spies = NETWORK.map((n) => [n, vi.fn()] as const);
      for (const [n, spy] of spies) vi.stubGlobal(n, spy);
      const { root, handle } = await mount();
      await c.drive?.(root);
      handle.destroy();
      for (const [, spy] of spies) expect(spy).not.toHaveBeenCalled();
    });
  });
}
