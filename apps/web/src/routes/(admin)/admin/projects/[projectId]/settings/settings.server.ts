/**
 * The Projekteinstellungen page's server side (v3 `settings/+page.server.ts`): the load and the saves. Branding, the
 * Standardansicht and the Chat are config, so every save is a builder Doc op on the project's draft (`settings-doc.ts`) and the
 * publish bar picks it up (WP-326); there is no second write path.
 */
import { createDraftStore, draftSources, ensureDraft, type Principal } from '@ueberblick/server';
import { openProject, type Doc } from '@ueberblick/builder';
import { localize, type TemplateFile } from '@ueberblick/core';
import { runtime } from '../../../../../../lib/server/runtime';
import { MAP_VIEW_DEFAULTS } from '../../../../../../lib/admin/settings/map-view';
import { chatView } from './chat-doc';
import { templateView } from './template-doc';
import { layerRows } from '../../../../../../lib/admin/settings/layers-model';
import { brandingView, mapView, type SettingsEdit, type SettingsErrorCode } from './settings-doc';
import { editFor } from './settings-edit';
import { CLUSTER_TOOL, FILTER_VIEWS_TOOL, startupView, toolStartView } from './start-doc';
import { loadLifecycle } from './lifecycle.server';
import { infoPageRows } from '../../../../../../lib/admin/settings/info-pages';
import { packLayerOptions, packRoleOptions, packRows } from '../../../../../../lib/admin/settings/packs';
import type {
  SettingsCall,
  SettingsDocData,
  SettingsPageData,
} from '../../../../../../lib/admin/settings/types';

export type SettingsCallResult =
  | { readonly ok: true; readonly body: SettingsDocData }
  | {
      readonly ok: false;
      readonly code: SettingsErrorCode;
      readonly detail?: string;
      readonly fields?: Extract<SettingsEdit, { ok: false }>['fields'];
      readonly layer?: Extract<SettingsEdit, { ok: false }>['layer'];
    };

/** The deployed project file, for a project that has no draft yet. */
function deployedFile(projectKey: string): TemplateFile | null {
  const row = runtime()
    .projectDb(projectKey)
    .prepare<{ compiled: string }>("SELECT compiled FROM config_versions WHERE status = 'deployed'")
    .get();
  return row ? ((JSON.parse(row.compiled) as { file?: TemplateFile }).file ?? null) : null;
}

function docData(projectKey: string, locale: string, file: TemplateFile | null): SettingsDocData {
  const rt = runtime();
  const row = rt.control.prepare<{ name: string }>('SELECT name FROM projects WHERE key = ?').get(projectKey);
  return {
    projectName: row?.name || projectKey,
    branding: file ? brandingView(file, locale) : { name: '', icon: null },
    map: file ? mapView(file) : { ...MAP_VIEW_DEFAULTS, saved: false },
    chat: file ? chatView(file, locale) : { enabled: false, all: false, roles: [], options: [] },
    template: file ? templateView(file, locale) : { key: '', label: '', version: '', inputs: [] },
    layers: {
      layers: layerRows(file?.map, locale),
      roles: Object.entries(file?.roles ?? {}).map(([key, r]) => ({
        key,
        label: localize(r.label, [locale]),
      })),
    },
    startup: file ? startupView(file, locale) : { layers: [], types: [] },
    cluster: file ? toolStartView(file, CLUSTER_TOOL, locale) : { declared: false, roles: [] },
    fieldFilters: file ? toolStartView(file, FILTER_VIEWS_TOOL, locale) : { declared: false, roles: [] },
    infoPages: file ? infoPageRows(file, locale) : [],
    packs: file ? packRows(file, locale) : [],
    packLayers: file ? packLayerOptions(file, locale) : [],
    roles: file ? packRoleOptions(file, locale) : [],
    mapConfig: (file?.map as SettingsDocData['mapConfig'] | undefined) ?? null,
  };
}

/** The draft's effective project file (or, with no draft yet, the deployed version's); null when neither exists. */
export function effectiveFile(projectKey: string): TemplateFile | null {
  const rt = runtime();
  const draft = createDraftStore(rt.projectDb(projectKey)).get();
  const sources = draft && draftSources(draft, rt.templates);
  return sources
    ? openProject(sources.templateSrc, sources.overlaySrc).effective()
    : deployedFile(projectKey);
}

/** The draft's values (or, with no draft yet, the deployed version's). */
export function loadSettings(projectKey: string, locale: string): SettingsPageData {
  const file = effectiveFile(projectKey);
  return { ...docData(projectKey, locale, file), lifecycle: loadLifecycle(projectKey, locale, file) };
}

/** One save: edit the draft's Doc, store it with the revision it started from, answer with what the page shows. */
export function runSettingsCall(
  projectKey: string,
  principal: Principal,
  locale: string,
  call: SettingsCall,
): SettingsCallResult {
  const by = principal.id;
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, by);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) return { ok: false, code: 'no_version' };
  const doc: Doc = openProject(sources.templateSrc, sources.overlaySrc);
  const edit = editFor(doc, call, locale);
  if (!edit.ok) return edit;
  if (edit.doc !== doc) {
    const saved = createDraftStore(rt.projectDb(projectKey)).putIf(
      ensured.draft.revision,
      edit.doc.save().overlaySrc,
      by,
      rt.clock.now(),
    );
    if (!saved.ok) return { ok: false, code: 'conflict' };
    rt.previews.schedulePreviewRefresh(projectKey);
  }
  return { ok: true, body: docData(projectKey, locale, edit.doc.effective()) };
}
