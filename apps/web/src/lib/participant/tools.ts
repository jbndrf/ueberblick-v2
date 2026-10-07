/**
 * Which tools the app has and how they load. Every tool is a dynamic import behind a `ToolLoader`
 * (`@ueberblick/ui/tool-api`): its code, and the core geo it may use, load on first mount and never with the shell.
 * The options of a tool for a field come from the project file (`tools.<key>`), the role's own settings on top, and
 * for `draw` the field's `geometry_type` and the map centre (WP-551).
 */
import type { Geo } from '@ueberblick/core/geo';
import type { JsonValue, Key, TemplateFile } from '@ueberblick/core/model';
import type { ChatDeps } from '@ueberblick/tool-chat';
import { resolveLabel } from '@ueberblick/ui';
import type { ToolLoader } from '@ueberblick/ui/tool-api';

export interface ToolLoaderDeps {
  readonly geo: () => Promise<Geo>;
  /** `FoldType.primaryGeometry` of a type (B-009): where a search result is centred. */
  readonly primaryGeometry: (type: Key) => Key | undefined;
  /** The project's `tools.search` settings for the role. */
  readonly searchSettings: Readonly<Record<string, JsonValue>>;
  /** What the Projekt-Chat reads from the device (`tools/chat.ts`); only the panel host has it (the chat is no field tool). */
  readonly chat?: ChatDeps;
}

export function toolLoaders(deps: ToolLoaderDeps): Readonly<Record<string, ToolLoader>> {
  return {
    photo: () => import('@ueberblick/tool-photo').then((m) => m.photoTool),
    file: () => import('@ueberblick/tool-file').then((m) => m.fileTool),
    draw: () => import('@ueberblick/tool-draw').then((m) => m.drawTool),
    measure: () => import('@ueberblick/tool-measure').then((m) => m.measureTool),
    chat: async () => {
      const { chat } = deps;
      if (chat === undefined) throw new Error('The chat tool is not hosted here.');
      return (await import('@ueberblick/tool-chat')).createChatTool(chat);
    },
    search: async () => {
      const [tool, geo] = await Promise.all([import('@ueberblick/tool-search'), deps.geo()]);
      return tool.createSearchTool({
        geo,
        sources: tool.readSearchSources(deps.searchSettings),
        primaryGeometry: deps.primaryGeometry,
      });
    },
  };
}

/** The keys `toolLoaders` answers for (loaders are not called). */
export function toolLoaderKeys(): readonly string[] {
  return Object.keys(
    toolLoaders({
      geo: () => Promise.reject(new Error('unused')),
      primaryGeometry: () => undefined,
      searchSettings: {},
    }),
  );
}

/** A tool's `typeLabel`: the type's label for `locale`, the key when the type has none (the same `resolveLabel` as the task labels). */
export function typeLabelOf(file: TemplateFile, locale: string): (type: Key) => string {
  return (type) => resolveLabel(file.types?.[type]?.label, locale, type);
}

/** The list's name column header: the view's type label, the type key when the type has none (R1); empty without a view. */
export function listNameHeader(file: TemplateFile, locale: string, typeKey: Key | undefined): string {
  return typeKey === undefined ? '' : typeLabelOf(file, locale)(typeKey);
}

/** The feature type a task works on: the type it creates, else where it is offered (the first of several). */
export function taskTypeOf(file: TemplateFile, taskKey: string): Key | undefined {
  const task = file.tasks?.[taskKey];
  if (task === undefined) return undefined;
  if (task.creates !== undefined) return task.creates as Key;
  const on = Array.isArray(task.on) ? task.on[0] : task.on;
  return typeof on === 'string' && !on.startsWith('$') ? (on as Key) : undefined;
}

/** A tool's settings: the project's `tools.<key>`, then the role's `app.tools.<key>.settings` over it; undefined when the project has no such tool. */
export function toolSettings(
  file: TemplateFile,
  roleKey: string,
  toolKey: string,
): Record<string, JsonValue> | undefined {
  const project = file.tools?.[toolKey];
  if (project === undefined) return undefined;
  const role = file.roles?.[roleKey]?.app?.tools?.[toolKey]?.settings ?? {};
  return { ...project, ...role } as Record<string, JsonValue>;
}

export interface FieldOptionsInput {
  readonly file: TemplateFile;
  readonly roleKey: string;
  /** The feature type the task works on (`taskTypeOf`). */
  readonly type: Key | undefined;
  /** [lon, lat] of the map centre, or undefined when the map does not know it yet. */
  readonly center: () => readonly [number, number] | undefined;
}

/** `ToolHostOptions.optionsFor` for one open task. */
export function fieldOptions(
  input: FieldOptionsInput,
): (toolKey: string, fieldKey: string) => Record<string, JsonValue> {
  const { file, roleKey, type } = input;
  return (toolKey, fieldKey) => {
    const base = toolSettings(file, roleKey, toolKey) ?? {};
    if (toolKey !== 'draw') return base;
    const property = type === undefined ? undefined : file.types?.[type]?.properties?.[fieldKey];
    const geometryType = property?.type === 'geometry' ? property.geometry_type : undefined;
    const center = input.center();
    return {
      ...base,
      ...(geometryType === undefined ? {} : { geometry_type: geometryType }),
      ...(center === undefined ? {} : { center: [center[0], center[1]] }),
    };
  };
}
