/**
 * The person's side of the tool platform (WP-613 `ToolPersonPort`) over the preference record (WP-612): the role's
 * availability and settings come from the project file, the switch and the preferences from `prefs.tools` and
 * `prefs.tool_prefs`. Edits work offline (the client queues them) and follow the person to every device.
 */
import type { PrefsClient } from '@ueberblick/client';
import type { JsonValue, TemplateFile } from '@ueberblick/core/model';
import type { ToolAvailability } from '@ueberblick/core/registry';
import type { ToolPersonPort } from '@ueberblick/ui/tool-api';
import type { ToolSwitchMap } from './entries';

export interface ToolPerson extends ToolPersonPort {
  /** All of the person's tool switches. */
  switches(): ToolSwitchMap;
  /** The person switched a tool on or off. Throws only for a key the record refuses. */
  setSwitch(toolKey: string, on: boolean): void;
  /** Calls `fn` after every change of the record; returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

export interface ToolPersonDeps {
  readonly file: TemplateFile;
  readonly roleKey: string;
  readonly prefs: PrefsClient;
  /** Called after every edit, so the app can send it (`prefs.sync()`); the edit itself is already kept on the device. */
  readonly flush?: () => void;
}

export function createToolPerson({ file, roleKey, prefs, flush }: ToolPersonDeps): ToolPerson {
  const write = (path: string, value: JsonValue): void => {
    prefs.set(path, value);
    flush?.();
  };
  const roleTools = () => file.roles?.[roleKey]?.app?.tools;
  return {
    availability(key) {
      const role = roleTools();
      if (role === undefined) return key in (file.tools ?? {}) ? 'active' : undefined;
      const entry = role[key];
      return entry === undefined ? undefined : ((entry.availability ?? 'active') as ToolAvailability);
    },
    settings(key) {
      const project = file.tools?.[key];
      const role = roleTools()?.[key]?.settings;
      return {
        ...(project === undefined ? {} : { project: project as Readonly<Record<string, JsonValue>> }),
        ...(role === undefined ? {} : { role: role as Readonly<Record<string, JsonValue>> }),
      };
    },
    switchOf: (key) => prefs.current().tools[key],
    preferencesOf: (key) =>
      prefs.current().tool_prefs[key] as Readonly<Record<string, JsonValue>> | undefined,
    setPreference: (key, name, value) => write(`tool_prefs.${key}.${name}`, value),
    switches: () => prefs.current().tools,
    setSwitch: (key, on) => write(`tools.${key}`, on),
    subscribe: (fn) => prefs.subscribe(() => fn()),
  };
}
