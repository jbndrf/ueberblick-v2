import { effectiveToolValues, toolIsOn, validateToolOptions } from '@ueberblick/core/registry/tools';
import type { JsonValue } from '@ueberblick/core/model';
import {
  PRODUCIBLE_SHAPES,
  ToolHostError,
  isFieldTool,
  type HashPort,
  type FieldToolContext,
  type PanelToolContext,
  type Tool,
  type ToolValuesContext,
  type ToolHandle,
  type ToolDataPort,
  type ToolHost,
  type ToolHostOptions,
} from './contract';
import { assertTool } from './define';

/** sha256 through WebCrypto (browser and Node). */
export const webCryptoHash: HashPort = {
  async sha256(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  },
};

/** Adds the config context to a mount context; `preferences` stays a live getter (a spread would freeze it). */
function withConfig<C extends ToolValuesContext>(
  cfg: ToolValuesContext,
  ctx: Omit<C, keyof ToolValuesContext>,
): C {
  return Object.defineProperties(ctx, {
    settings: { value: cfg.settings, enumerable: true },
    preferences: { get: () => cfg.preferences, enumerable: true },
    setPreference: { value: cfg.setPreference, enumerable: true },
  }) as C;
}

export function createToolHost(options: ToolHostOptions): ToolHost {
  const locale = options.locale ?? 'en';
  const cache = new Map<string, Promise<Tool>>();

  function load(key: string): Promise<Tool> {
    const loader = Object.hasOwn(options.loaders, key) ? options.loaders[key] : undefined;
    if (!loader) return Promise.reject(new ToolHostError('unknown_tool', key, `Unknown tool "${key}"`));
    let p = cache.get(key);
    if (!p) {
      // Every loaded tool passes the runtime guard, so a hand-built object cannot skip `defineTool`.
      p = loader().then((tool) => {
        assertTool(tool, key);
        return tool;
      });
      // A failed load is retried on the next mount.
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return p;
  }

  /** The availability gate: a tool the role does not list, or the person switched off, is never mounted. */
  function assertOn(key: string): void {
    const config = options.person;
    if (config === undefined) return;
    if (!toolIsOn(config.availability(key), config.switchOf(key)))
      throw new ToolHostError('tool_off', key, `Tool "${key}" is not on for this person`);
  }

  /** `settings`, `preferences` (current at each read) and `setPreference` of one mount. */
  function configContext(tool: Tool, isLive: () => boolean): ToolValuesContext {
    const config = options.person;
    const schemas = {
      ...(tool.settings && { settings: tool.settings }),
      ...(tool.preferences && { preferences: tool.preferences }),
    };
    const layers = () => ({
      ...(config ? config.settings(tool.key) : {}),
      personal: config?.preferencesOf(tool.key),
    });
    const effective = () => effectiveToolValues(schemas, layers());
    const refuse = (message: string): never => {
      throw new ToolHostError('invalid_preference', tool.key, message);
    };
    return {
      settings: effective().settings as Readonly<Record<string, JsonValue>>,
      get preferences() {
        return effective().preferences as Readonly<Record<string, JsonValue>>;
      },
      setPreference(key, value) {
        if (!isLive()) throw new ToolHostError('unmounted', tool.key, 'The tool is not mounted');
        if (config === undefined) return refuse('There is no preference store');
        const issues = validateToolOptions(tool.preferences ?? {}, { [key]: value });
        const first = issues[0];
        if (first) return refuse(`Preference "${key}" ${first.message}`);
        config.setPreference(tool.key, key, value);
      },
    };
  }

  /** `ctx.data` for a tool that declares it and has a stream; nothing otherwise (no key, no property). */
  function dataOf(tool: Tool): { readonly data?: ToolDataPort } {
    if (isFieldTool(tool) || tool.data !== true) return {};
    const port = options.data?.forTool(tool.key);
    return port ? { data: port } : {};
  }

  return {
    async mountField(el, input) {
      const tool = await load(input.toolKey);
      if (!isFieldTool(tool))
        throw new ToolHostError('wrong_point', input.toolKey, `Tool "${input.toolKey}" has no form-field`);
      assertOn(input.toolKey);
      if (tool.produces !== input.field.type)
        throw new ToolHostError(
          'wrong_field_type',
          input.toolKey,
          `Tool "${input.toolKey}" produces ${tool.produces}, field "${input.field.key}" is ${input.field.type}`,
        );
      let live = true;
      const alive = (): void => {
        if (!live) throw new ToolHostError('unmounted', input.toolKey, 'The tool is not mounted');
      };
      const handle = tool.mount(
        el,
        withConfig<FieldToolContext>(
          configContext(tool, () => live),
          {
            field: input.field,
            locale,
            // Live: the form can change the value under the tool (the gallery removes a file).
            get value() {
              return input.value;
            },
            options: options.optionsFor?.(input.toolKey, input.field.key) ?? {},
            ports: options.ports,
            produce(value) {
              alive();
              if (!PRODUCIBLE_SHAPES[tool.produces](value))
                throw new ToolHostError('invalid_value', input.toolKey, `Not a ${tool.produces} value`);
              input.onproduce(value);
            },
            clear() {
              alive();
              input.onclear();
            },
          },
        ),
      );
      return {
        destroy() {
          live = false;
          handle.destroy();
        },
      } satisfies ToolHandle;
    },
    async mountPanel(el, input) {
      const tool = await load(input.toolKey);
      if (isFieldTool(tool) || !tool.contributes.includes(input.point))
        throw new ToolHostError(
          'wrong_point',
          input.toolKey,
          `Tool "${input.toolKey}" does not contribute to ${input.point}`,
        );
      assertOn(input.toolKey);
      let live = true;
      const handle = tool.mount(
        el,
        withConfig<PanelToolContext>(
          configContext(tool, () => live),
          {
            point: input.point,
            locale,
            ports: options.ports,
            startTask: input.startTask,
            map: input.map,
            openFeature: input.openFeature,
            searchText: input.searchText,
            feature: input.feature,
            typeLabel: input.typeLabel,
            ...dataOf(tool),
          },
        ),
      );
      return {
        destroy() {
          live = false;
          handle.destroy();
        },
      } satisfies ToolHandle;
    },
  };
}
