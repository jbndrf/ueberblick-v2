// `defineTool`: the one way to make a tool (WP-553, API 2 in WP-613). Types keep the two contracts apart (a
// `form-field` tool gets `produce`/`clear` and no map; a panel tool gets the map and no `produce`); the
// runtime guard below catches what types cannot (untyped JS, a tool built against another API version, a
// loader that returns junk).
import {
  PRODUCIBLE_SHAPES as SHAPES,
  TOOL_CONTRIBUTIONS,
  TOOL_OPTION_TYPES,
} from '@ueberblick/core/registry';
import { toolOptionIssue, type ToolOption } from '@ueberblick/core/registry/tools';
import {
  ToolHostError,
  TOOL_API_VERSION,
  type FieldTool,
  type FieldToolSpec,
  type PanelTool,
  type PanelToolSpec,
  type Tool,
} from './contract';

function refuse(key: string, message: string): never {
  throw new ToolHostError('invalid_definition', key, message);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function assertOptions(key: string, what: 'settings' | 'preferences', raw: unknown): void {
  if (raw === undefined) return;
  if (!isRecord(raw)) refuse(key, `Tool "${key}": ${what} must be an object of options`);
  for (const [name, o] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRecord(o) || typeof o.type !== 'string' || !TOOL_OPTION_TYPES.has(o.type))
      refuse(key, `Tool "${key}": ${what}.${name} needs a type of ${TOOL_OPTION_TYPES.keys.join(', ')}`);
    const option = o as unknown as ToolOption;
    if (option.type === 'select' && !Array.isArray(option.options))
      refuse(key, `Tool "${key}": ${what}.${name} is a select and needs \`options\``);
    if (option.default !== undefined && toolOptionIssue(option, option.default))
      refuse(key, `Tool "${key}": the default of ${what}.${name} does not fit its own schema`);
  }
}

/** Throws a `ToolHostError` unless `tool` is a valid definition of this API version. The host runs it on
 * every loaded tool, so a hand-built object cannot bypass `defineTool`. */
export function assertTool(tool: unknown, expectedKey?: string): asserts tool is Tool {
  if (!isRecord(tool)) return refuse(expectedKey ?? '?', 'A tool must be an object');
  const t = tool;
  const key = typeof t.key === 'string' && t.key !== '' ? t.key : (expectedKey ?? '?');
  if (typeof t.key !== 'string' || t.key === '') refuse(key, 'A tool needs a non-empty `key`');
  const c = t.contributes;
  if (!Array.isArray(c) || c.length === 0)
    refuse(key, `Tool "${key}": contributes must list at least one of ${TOOL_CONTRIBUTIONS.keys.join(', ')}`);
  const points = c as unknown[];
  for (const p of points)
    if (typeof p !== 'string' || !TOOL_CONTRIBUTIONS.has(p))
      refuse(key, `Tool "${key}": contribution point must be one of ${TOOL_CONTRIBUTIONS.keys.join(', ')}`);
  if (new Set(points).size !== points.length)
    refuse(key, `Tool "${key}": a contribution point is listed twice`);
  const isField = points.includes('form-field');
  if (isField && points.length > 1)
    refuse(key, `Tool "${key}": form-field cannot be combined with another point`);
  if (typeof t.mount !== 'function') refuse(key, `Tool "${key}": mount must be a function`);
  if (isField) {
    if (typeof t.produces !== 'string' || !Object.hasOwn(SHAPES, t.produces))
      refuse(key, `Tool "${key}": a form-field tool produces one of ${Object.keys(SHAPES).join(', ')}`);
  } else if ('produces' in t) refuse(key, `Tool "${key}": only a form-field tool produces a value`);
  if (t.data !== undefined && (t.data !== true || isField))
    refuse(key, `Tool "${key}": \`data\` is \`true\` and only a panel tool may keep a data stream`);
  assertOptions(key, 'settings', t.settings);
  assertOptions(key, 'preferences', t.preferences);
  if (!Object.hasOwn(t, 'api')) refuse(key, `Tool "${key}" was not made with defineTool`);
  if (t.api !== TOOL_API_VERSION)
    throw new ToolHostError(
      'unsupported_api',
      key,
      `Tool "${key}" targets tool API ${String(t.api)}, this host speaks ${TOOL_API_VERSION}`,
    );
}

/** Defines a tool of the tool API `TOOL_API_VERSION`. In a task: `contributes: ['form-field']`, `produces`,
 * `mount`. Outside tasks: the sheet points it contributes to, and `mount`. `settings` (the admin) and
 * `preferences` (the person, with defaults) are option schemas. Returns a frozen, version-stamped tool. */
export function defineTool(spec: FieldToolSpec): FieldTool;
export function defineTool(spec: PanelToolSpec): PanelTool;
export function defineTool(spec: FieldToolSpec | PanelToolSpec): Tool {
  const tool = Object.freeze({ ...spec, api: TOOL_API_VERSION });
  assertTool(tool);
  return tool as Tool;
}
