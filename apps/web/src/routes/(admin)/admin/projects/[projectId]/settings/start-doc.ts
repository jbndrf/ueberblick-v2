/**
 * The Erststart, Filter & Felder and Cluster edits on the project's document (WP-386, S3-17). What v3 kept in
 * `startup_defaults` is config in v4, so each save is a set of builder Doc ops on the draft overlay (R1, R3):
 * - the layers on at start are `map.layers.<k>.on_at_start` (the map's own default: `defaultSelection`);
 * - "Beim Start aktiv" of a tool is the role's availability of it: `active` is on at first, `offered` lets the person
 *   switch it on (`roles.<r>.app.tools.<key>.availability`, WP-613), and the project declares the tool (`tools.<key>`).
 * Headless: it takes a `Doc` and returns the next one; the server module saves it.
 */
import { applyOps, type Doc, type Op } from '@ueberblick/builder';
import { localize, toolAvailabilityFor, type TemplateFile } from '@ueberblick/core';
import { orderedLayerKeys } from '@ueberblick/core/registry';
import type {
  RoleStart,
  StartLayer,
  StartupValues,
  StartupView,
  ToolStartView,
} from '../../../../../../lib/admin/settings/start-types';
import type { SettingsEdit } from './settings-doc';
import { setStartTypes, startTypesView } from './start-visible-doc';

/** v3 `tools.cluster`: the Cluster tab of Karteninhalt (WP-666). */
export const CLUSTER_TOOL = 'cluster';
/** v3 `filter.field_filters`: the Ansichten tab and its filter builder (WP-665). */
export const FILTER_VIEWS_TOOL = 'views';

function run(doc: Doc, ops: readonly Op[]): SettingsEdit {
  if (ops.length === 0) return { ok: true, doc };
  const r = applyOps(doc, ops);
  if ('refused' in r) return { ok: false, code: 'refused', detail: r.refused.message };
  return { ok: true, doc: r.doc };
}

/** The map's layers in draw order, each with its kind and whether it is on at start. */
export function startupView(file: TemplateFile, locale: string): StartupView {
  const map = file.map;
  const types = startTypesView(file, locale);
  if (map === undefined) return { layers: [], types };
  const layers: StartLayer[] = orderedLayerKeys(map).flatMap((key) => {
    const l = map.layers[key];
    return l === undefined
      ? []
      : [
          {
            key,
            label: localize(l.label, [locale]) || key,
            kind: l.kind as StartLayer['kind'],
            on: l.on_at_start === true,
          },
        ];
  });
  return { layers, types };
}

/**
 * Saves v3's "Basisebene" radio and "Overlay-Ebenen (beim Start an)" checkboxes: `base` is the one base layer on at
 * start (null: none is flagged, so the map starts on the first base), `overlays` the overlays that are on. Only a layer
 * whose flag changes is written.
 */
export function setStartup(doc: Doc, values: StartupValues): SettingsEdit {
  const layers = doc.effective().map?.layers ?? {};
  const known = (key: string, kind: string): boolean => layers[key]?.kind === kind;
  if (values.base !== null && !known(values.base, 'base')) return { ok: false, code: 'invalid' };
  if (!values.overlays.every((k) => known(k, 'overlay'))) return { ok: false, code: 'invalid' };
  const ops: Op[] = [];
  for (const [key, layer] of Object.entries(layers)) {
    const want = layer.kind === 'base' ? key === values.base : values.overlays.includes(key);
    if (want !== (layer.on_at_start === true))
      ops.push({ kind: 'set', path: `map.layers.${key}.on_at_start`, value: want });
  }
  const layered = run(doc, ops);
  return layered.ok ? setStartTypes(layered.doc, values.types) : layered;
}

/** How every role has the tool: its availability, or none (the role does not have it, or the project lacks it). */
export function toolStartView(file: TemplateFile, tool: string, locale: string): ToolStartView {
  const roles: RoleStart[] = Object.entries(file.roles ?? {}).map(([key, role]) => ({
    key,
    label: localize(role.label, [locale]) || key,
    state: toolAvailabilityFor(file, [key], tool) ?? 'none',
  }));
  return { declared: file.tools !== undefined && Object.hasOwn(file.tools, tool), roles };
}

/**
 * v3's "Beim Start aktiv" switch of a tool for `roleKeys` (null: every role, v3's one project-wide control).
 * - on: the project declares the tool and each role has it `active`. A role with no tool list already has every
 *   project tool; a role that lists tools gets the tool listed, or its `offered` raised to `active`.
 * - off: each role that has the tool gets `offered` (the person may still switch it on). A role without a tool list is
 *   given the list of the project's tools so that only this one changes. A role that does not have the tool stays so:
 *   switching off never grants anything.
 */
export function setToolStart(
  doc: Doc,
  tool: string,
  roleKeys: readonly string[] | null,
  on: boolean,
): SettingsEdit {
  const file = doc.effective();
  const roles = file.roles ?? {};
  const targets = roleKeys ?? Object.keys(roles);
  const unknown = targets.find((k) => roles[k] === undefined);
  if (unknown !== undefined) return { ok: false, code: 'refused', detail: `unknown role ${unknown}` };
  const declared = file.tools !== undefined && Object.hasOwn(file.tools, tool);
  // The role's availability as it will be once the project declares the tool (core's one rule, R1).
  const declaring = { ...file, tools: { ...file.tools, [tool]: {} } };
  const ops: Op[] = [];
  if (on && !declared) ops.push({ kind: 'set', path: `tools.${tool}`, value: {} });
  for (const key of targets) {
    const app = roles[key]?.app;
    const listed = app?.tools;
    const base = `roles.${key}.app.tools`;
    if (listed === undefined) {
      if (on || !declared) continue; // every project tool is already active
      const all = Object.fromEntries(Object.keys(file.tools ?? {}).map((k) => [k, {}]));
      const tools = { ...all, [tool]: { availability: 'offered' } };
      ops.push(
        app === undefined
          ? { kind: 'set', path: `roles.${key}.app`, value: { tools } }
          : { kind: 'set', path: base, value: tools },
      );
    } else if (Object.hasOwn(listed, tool)) {
      const active = toolAvailabilityFor(declaring, [key], tool) !== 'offered';
      if (on !== active)
        ops.push({ kind: 'set', path: `${base}.${tool}.availability`, value: on ? 'active' : 'offered' });
    } else if (on) ops.push({ kind: 'set', path: `${base}.${tool}`, value: {} });
  }
  return run(doc, ops);
}
