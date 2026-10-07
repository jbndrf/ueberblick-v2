// Tool options (WP-613, tool-platform.md §3.4): the declarative schema a tool uses for its settings (admin)
// and preferences (person), and the pure functions every runtime shares: validation, effective values and
// the on/off switch. It sits in the registry subpath because participant code (ui, client) may import
// that, but not `schema/` (R14: Zod stays out of the shell). Pure: no I/O (R2).
import type { ToolAvailability, ToolOptionType } from './ui';

/** One option of a tool. Which fields apply depends on `type`. */
export interface ToolOption {
  readonly type: ToolOptionType;
  readonly default?: unknown;
  readonly description?: string;
  /** `select`: the allowed values. */
  readonly options?: readonly string[];
  /** `number`, `integer`: inclusive bounds. */
  readonly min?: number;
  readonly max?: number;
  /** `number`: exclusive lower bound. */
  readonly above?: number;
}

/** The options a tool declares: `settings` (the admin sets them) and `preferences` (the person may). */
export type ToolOptions = Readonly<Record<string, ToolOption>>;

/** A value that does not fit: `path` is the option key, plus the list index for a list entry. */
export interface ToolOptionIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function numberIssue(o: ToolOption, v: unknown): string | undefined {
  if (!isNumber(v) || (o.type === 'integer' && !Number.isInteger(v)))
    return `must be ${o.type === 'integer' ? 'a whole number' : 'a number'}`;
  if (o.min !== undefined && v < o.min) return `must be at least ${o.min}`;
  if (o.max !== undefined && v > o.max) return `must be at most ${o.max}`;
  if (o.above !== undefined && v <= o.above) return `must be above ${o.above}`;
  return undefined;
}

/** Why `value` does not fit `option` (path relative to the option), or undefined when it does. */
export function toolOptionIssue(option: ToolOption, value: unknown): ToolOptionIssue | undefined {
  const at = (message: string | undefined, i?: number): ToolOptionIssue | undefined =>
    message === undefined ? undefined : { path: i === undefined ? [] : [i], message };
  switch (option.type) {
    case 'boolean':
      return at(typeof value === 'boolean' ? undefined : 'must be true or false');
    case 'string':
      return at(typeof value === 'string' ? undefined : 'must be a text');
    case 'number':
    case 'integer':
      return at(numberIssue(option, value));
    case 'select':
      return at(
        typeof value === 'string' && (option.options ?? []).includes(value)
          ? undefined
          : `must be one of ${(option.options ?? []).join(', ')}`,
      );
    case 'string_list': {
      if (!Array.isArray(value)) return at('must be a list of texts');
      const i = value.findIndex((e) => typeof e !== 'string');
      return i < 0 ? undefined : at('must be a text', i);
    }
  }
}

/** Checks `values` against the options: unknown keys and misfitting values, each with its path. */
export function validateToolOptions(
  options: ToolOptions,
  values: Readonly<Record<string, unknown>>,
): ToolOptionIssue[] {
  const issues: ToolOptionIssue[] = [];
  for (const [key, value] of Object.entries(values)) {
    const option = Object.hasOwn(options, key) ? options[key] : undefined;
    if (option === undefined) {
      const known = Object.keys(options).join(', ') || 'none';
      issues.push({ path: [key], message: `is not an option of this tool (known: ${known})` });
      continue;
    }
    const issue = toolOptionIssue(option, value);
    if (issue) issues.push({ path: [key, ...issue.path], message: issue.message });
  }
  return issues;
}

/** The schemas of one tool. Both default to no options. */
export interface ToolSchemas {
  readonly settings?: ToolOptions;
  readonly preferences?: ToolOptions;
}

/** One layer of values: absent means nothing set. */
type Layer = Readonly<Record<string, unknown>> | undefined;

export interface ToolLayers {
  readonly project?: Layer;
  readonly role?: Layer;
  /** The person's `prefs.tool_prefs[key]`. */
  readonly personal?: Layer;
}

export interface EffectiveToolValues {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly preferences: Readonly<Record<string, unknown>>;
}

function defaultsOf(options: ToolOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, o] of Object.entries(options)) if (o.default !== undefined) out[k] = o.default;
  return out;
}

function overlay(into: Record<string, unknown>, options: ToolOptions, layer: Layer): void {
  if (layer === undefined) return;
  for (const k of Object.keys(options))
    if (Object.hasOwn(layer, k) && layer[k] !== undefined) into[k] = layer[k];
}

/** Effective values = schema defaults, then project settings, then role settings, then (only for
 * preference keys) the person's preferences. A person can never override a settings-only key. */
export function effectiveToolValues(schemas: ToolSchemas, layers: ToolLayers): EffectiveToolValues {
  const settingsOptions = schemas.settings ?? {};
  const preferenceOptions = schemas.preferences ?? {};
  const settings = defaultsOf(settingsOptions);
  overlay(settings, settingsOptions, layers.project);
  overlay(settings, settingsOptions, layers.role);
  const preferences = defaultsOf(preferenceOptions);
  overlay(preferences, preferenceOptions, layers.project);
  overlay(preferences, preferenceOptions, layers.role);
  overlay(preferences, preferenceOptions, layers.personal);
  return { settings, preferences };
}

/** Is the tool on for this person? The availability default, changed by the person's own switch
 * (`prefs.tools[key]`). Absent availability means the tool does not exist for the role: never on. */
export function toolIsOn(availability: ToolAvailability | undefined, personal: boolean | undefined): boolean {
  if (availability === undefined) return false;
  return personal ?? availability === 'active';
}

/** The parts of a project file the availability rule reads (a `TemplateFile` satisfies it). */
export interface ToolProfileFile {
  readonly tools?: Readonly<Record<string, unknown>> | undefined;
  readonly roles?:
    | Readonly<
        Record<
          string,
          | {
              readonly app?:
                | {
                    readonly tools?:
                      | Readonly<Record<string, { readonly availability?: string | undefined } | undefined>>
                      | undefined;
                  }
                | undefined;
            }
          | undefined
        >
      >
    | undefined;
}

/**
 * Which availability a person with these roles has for a tool: the one rule the server's access check, the shell model
 * and the tool entries share (R1). The project must declare the tool (`tools.<key>`). A role without `app.tools` (or
 * unknown to the file) has the project's tools, active; a role that lists tools has only those, a listed tool without
 * `availability` is active (WP-613). With several roles `active` beats `offered`; undefined means none of them has it.
 */
export function toolAvailabilityFor(
  file: ToolProfileFile,
  roleKeys: readonly string[],
  key: string,
): ToolAvailability | undefined {
  if (file.tools === undefined || !Object.hasOwn(file.tools, key)) return undefined;
  let best: ToolAvailability | undefined;
  for (const role of roleKeys) {
    const listed = file.roles?.[role]?.app?.tools;
    let a: ToolAvailability | undefined;
    if (listed === undefined) a = 'active';
    else if (Object.hasOwn(listed, key)) a = listed[key]?.availability === 'offered' ? 'offered' : 'active'; // `compile` rejects other values
    if (a === 'active') return 'active';
    if (a !== undefined) best = a;
  }
  return best;
}

/** Checks one layer of `tools.<key>` (project) or a role's `settings` against the tool's schemas. A key
 * may be a setting or a preference (the admin can set the default of a preference). */
export function checkToolLayer(
  schemas: ToolSchemas,
  layer: Readonly<Record<string, unknown>>,
): ToolOptionIssue[] {
  return validateToolOptions({ ...schemas.preferences, ...schemas.settings }, layer);
}

/** Settings schemas of the tools that ship with the app, so `compile` can check `tools.<key>` and
 * `roles.<r>.app.tools.<key>.settings` without importing a tool package (core stays pure). The tool
 * packages pass the same objects to `defineTool` (R1). A tool that is not listed has unchecked settings. */
export const BUILTIN_TOOL_SCHEMAS = {
  search: {
    settings: {
      sources: { type: 'string_list', description: 'Searchable properties as `type.property`.' },
    },
  },
  measure: {},
  photo: {
    settings: {
      maxEdge: {
        type: 'integer',
        min: 16,
        max: 16384,
        default: 2048,
        description: 'Longest edge in pixels.',
      },
      quality: { type: 'number', above: 0, max: 1, default: 0.85, description: 'JPEG quality.' },
      allowLocation: { type: 'boolean', default: false, description: 'Keep the location in the photo.' },
    },
  },
  draw: {},
  // Projekt-Chat (B-020): no settings. Who has it is `roles.<r>.app.tools.chat.availability` (v3's chat_visible_to_roles).
  chat: {},
} as const satisfies Readonly<Record<string, ToolSchemas>>;
