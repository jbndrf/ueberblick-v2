/**
 * Phase 4: what participants see. Views (map, one list per feature type, one per data tab), the
 * per-role app profiles, tool settings, and the project-level settings, layers and pages of v3.
 */
import type { RoleApp, View } from '@ueberblick/core';
import type { Entry } from './build';
import { valueProp, type Ctx } from './ctx';
import type { KeySpace } from './keys';
import type { Rec, SrcProject } from './model';
import { isRec, unref } from './read';

export interface Camera {
  readonly center: [number, number];
  readonly zoom: number;
}

/** The v3 default map position (Germany), also the template's camera; a project's own is an overlay entry. */
export const DEFAULT_CAMERA: Camera = { center: [10.4515, 51.1657], zoom: 10 };

export const MAP_VIEW = 'karte';

const STYLE_TYPE: Record<string, { type: string; paint: string }> = {
  point: { type: 'circle', paint: 'circle-color' },
  line: { type: 'line', paint: 'line-color' },
  polygon: { type: 'fill', paint: 'fill-color' },
};
const DEFAULT_COLOR = '#6366f1';

const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);

export interface Views {
  readonly views: Record<string, View>;
  /** View keys per type key, for role apps. */
  readonly byType: Map<string, string[]>;
  readonly camera: Camera;
}

/** Project settings: map defaults become the camera; the rest is reported. */
function settings(
  project: SrcProject,
  ctx: Ctx,
): { camera: Camera; visible: Set<string> | undefined; label: string } {
  const s = project.settings;
  const { report } = ctx;
  let camera = DEFAULT_CAMERA;
  let visible: Set<string> | undefined;
  const md = isRec(s['map_defaults']) ? (s['map_defaults'] as Rec) : undefined;
  if (md) {
    const c = isRec(md['center']) ? (md['center'] as Rec) : {};
    const lat = typeof c['lat'] === 'number' ? c['lat'] : DEFAULT_CAMERA.center[1];
    const lng = typeof c['lng'] === 'number' ? c['lng'] : DEFAULT_CAMERA.center[0];
    camera = { center: [lng, lat], zoom: typeof md['zoom'] === 'number' ? md['zoom'] : DEFAULT_CAMERA.zoom };
    if (md['min_zoom'] !== undefined || md['max_zoom'] !== undefined) {
      report.approximated(
        'settings.map_defaults',
        'the camera has centre and zoom only; the zoom limits are dropped',
        `views.${MAP_VIEW}.camera`,
      );
    } else report.mapped('settings.map_defaults', `views.${MAP_VIEW}.camera`);
  }
  const sd = isRec(s['startup_defaults']) ? (s['startup_defaults'] as Rec) : undefined;
  if (sd) {
    const list = sd['workflow_ids_visible'];
    if (Array.isArray(list))
      visible = new Set(list.filter((x): x is string => typeof x === 'string').map(unref));
    report.approximated(
      'settings.startup_defaults',
      'only the list of visible feature types is kept (as the map layers); base layer, overlays, features and tag values are dropped',
      `views.${MAP_VIEW}.layers`,
    );
  }
  if ('admin_presets' in s) {
    report.dropped(
      'settings.admin_presets',
      'saved filter presets are not converted; recreate them as views',
    );
  }
  for (const k of [
    'consent_banner_title',
    'consent_banner_body',
    'consent_accept_label',
    'consent_reject_label',
    'require_consent_before_login',
  ]) {
    if (k in s)
      report.dropped(
        `settings.${k}`,
        'consent texts are platform settings in v4, not part of a project file',
      );
  }
  const label = str(s['display_name']) ?? project.name;
  if ('display_name' in s) report.mapped('settings.display_name', 'template.label');
  for (const k of Object.keys(s)) {
    if (!report.has(`settings.${k}`))
      report.dropped(`settings.${k}`, `unknown v3 setting "${k}" has no v4 counterpart`);
  }
  return { camera, visible, label };
}

export function buildViews(
  project: SrcProject,
  entries: readonly Entry[],
  ctx: Ctx,
  space: KeySpace,
): Views & { label: string } {
  const { camera, visible, label } = settings(project, ctx);
  const views: Record<string, View> = {};
  const byType = new Map<string, string[]>();
  const add = (typeKey: string, viewKey: string): void => {
    byType.set(typeKey, [...(byType.get(typeKey) ?? []), viewKey]);
  };
  const workflows = entries.filter((e) => e.src && !(e.src.record['is_active'] === false));
  const geo = workflows.filter((e) => e.info.geomKey && e.src);
  const shown = geo.filter((e) => visible === undefined || visible.has(e.info.v3Key));
  const first = shown[0];
  if (first) {
    const mapKey = space.take(MAP_VIEW);
    const layers: NonNullable<View['layers']> = {};
    for (const e of shown) {
      const gt = str(e.src?.record['geometry_type']) ?? 'point';
      const st = STYLE_TYPE[gt] ?? (STYLE_TYPE['point'] as { type: string; paint: string });
      const color = str(e.src?.record['marker_color']) ?? DEFAULT_COLOR;
      layers[e.info.key] = {
        source: { type: e.info.key },
        renderer: 'maplibre-2d',
        style: { layers: [{ id: e.info.key, type: st.type, paint: { [st.paint]: color } }] },
      };
      add(e.info.key, mapKey);
    }
    views[mapKey] = {
      label: { de: 'Karte', en: 'Map' },
      source: { type: first.info.key },
      camera: { center: [...DEFAULT_CAMERA.center], zoom: DEFAULT_CAMERA.zoom },
      layers,
    };
  }
  for (const e of workflows) {
    const src = e.src;
    if (!src) continue;
    const listKey = space.take(`${e.info.key}_liste`);
    views[listKey] = { label: str(src.record['name']) ?? e.info.key, source: { type: e.info.key } };
    add(e.info.key, listKey);
    for (const tab of [...(src.tabs?.tabs ?? [])].sort((a, b) => a.order - b.order)) {
      const props = tab.props
        .map((p) => valueProp(e.info, p)?.key)
        .filter((k): k is string => k !== undefined);
      const vk = space.take(`${e.info.key}_${tab.name}`);
      if (props.length === 0) {
        ctx.report.dropped(tab.id, "none of the tab's fields exists");
        continue;
      }
      views[vk] = { label: tab.name, source: { type: e.info.key }, properties: props };
      add(e.info.key, vk);
      ctx.report.approximated(
        tab.id,
        "a data tab becomes a view that carries its properties; row and column layout is the renderer's job",
        `views.${vk}`,
      );
    }
    if (src.tabs) ctx.report.mapped(src.tabs.id, 'views');
  }
  return { views, byType, camera: { center: camera.center, zoom: camera.zoom }, label };
}

/** Role app profiles: home, the views a role may see, and the tools that forms use. */
export function buildRoles(
  project: SrcProject,
  entries: readonly Entry[],
  ctx: Ctx,
  views: Views,
): Record<string, { label: string; app: RoleApp }> {
  const out: Record<string, { label: string; app: RoleApp }> = {};
  for (const role of project.roles) {
    const key = ctx.role(role.key);
    const r = role.record;
    const seen: string[] = [];
    for (const e of entries) {
      if (!e.src) continue;
      const rowRoles = Array.isArray(e.src.record['visible_to_roles'])
        ? (e.src.record['visible_to_roles'] as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .map((x) => ctx.role(unref(x)))
        : [];
      if (rowRoles.length > 0 && !rowRoles.includes(key)) continue;
      for (const v of views.byType.get(e.info.key) ?? []) if (!seen.includes(v)) seen.push(v);
    }
    const app: RoleApp = { views: Object.fromEntries(seen.map((v) => [v, {}])), shortcuts: {} };
    const home = seen.includes(MAP_VIEW) ? MAP_VIEW : seen[0];
    if (home) app.home = home;
    if (ctx.toolsUsed.size > 0) app.tools = Object.fromEntries([...ctx.toolsUsed].map((t) => [t, {}]));
    out[key] = { label: str(r['name']) ?? role.key, app };
    ctx.report.mapped(role.id, `roles.${key}`);
    ctx.report.columns(role.id, r, {
      name: ['mapped', undefined, `roles.${key}.label`],
      description: ['dropped', 'roles have a name only in v4'],
      max_instances: ['dropped', 'per-role quotas are not part of the v4 config'],
    });
  }
  return out;
}

/** Map layers, info pages: no v4 place in schema v1. */
export function reportUnmodelled(project: SrcProject, ctx: Ctx): void {
  for (const l of project.layers) {
    ctx.report.dropped(
      l.id,
      'basemaps and overlay sources are not part of the project file in schema v1; configure them in the app',
    );
    ctx.report.columns(l.id, l.record, {
      name: ['dropped', 'basemaps and overlay sources are not part of the project file in schema v1'],
      source_type: ['dropped', 'basemaps and overlay sources are not part of the project file in schema v1'],
      layer_type: ['dropped', 'basemaps and overlay sources are not part of the project file in schema v1'],
      url: ['dropped', 'basemaps and overlay sources are not part of the project file in schema v1'],
      display_order: [
        'dropped',
        'basemaps and overlay sources are not part of the project file in schema v1',
      ],
      visible_to_roles: [
        'dropped',
        'basemaps and overlay sources are not part of the project file in schema v1',
      ],
      is_active: ['dropped', 'basemaps and overlay sources are not part of the project file in schema v1'],
      config: ['dropped', 'basemaps and overlay sources are not part of the project file in schema v1'],
    });
  }
  for (const p of project.pages)
    ctx.report.dropped(p.id, "v4 has no info pages yet; keep the text in the project's own documentation");
  ctx.report.dropped('source.description', 'the template header has no description');
  ctx.report.mapped('source.name', 'template.label');
}
