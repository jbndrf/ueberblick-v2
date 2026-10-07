import { error, fail } from '@sveltejs/kit';
import {
  clearMarker,
  clearValueIcon,
  iconsState,
  openProject,
  setClassifyProperty,
  setMarker,
  setValueIcon,
  type Doc,
  type IconEdit,
  type IconErrorCode,
} from '@ueberblick/builder';
import { createDraftStore, draftSources, ensureDraft, type Principal } from '@ueberblick/server';
import { adminOf } from '../../../../../../../lib/admin/projects/admin-guard.server';
import { actorSourcesOf } from '../../../../../../../lib/admin/actor-names.server';
import { loadDataPage } from '../../../../../../../lib/admin/data/load.server';
import { loadDraft } from '../../../../../../../lib/admin/draft/draft-source.server';
import { loadImportSetup } from '../../../../../../../lib/admin/import/setup.server';
import { authorizeAdmin } from '../../../../../../../lib/server/authz';
import { runtime } from '../../../../../../../lib/server/runtime';
import type { IconCall, IconsState } from '../../../../../../../lib/admin/icons/types';
import { adminMessage, type AdminKey } from '../../../../shell/messages';
import { LOCALE_COOKIE, resolveLocale, type Locale } from '../../../../shell/locale';
import { draftOrDeployed } from './edit.server';
import { headerAnswer, isHeaderCall, loadHeader, runHeaderCall } from './header.server';
import { isMenuCall, menuAnswer, runMenuCall } from './menu.server';
import type { Actions, PageServerLoad } from './$types';

/**
 * The data page of one Objektart (v3 `workflows/[workflowId]/+page.server.ts`): the type as deployed (for the
 * columns) and the roster (for names). The rows are not loaded here: the table asks the list API, page by page.
 * The type must be in the project's draft (the sidebar's list); a type only in the draft has no table yet.
 */
export const load: PageServerLoad = async ({ locals, url, params, parent }) => {
  adminOf(locals, url);
  const auth = authorizeAdmin(locals.admin, params.projectId);
  if (auth instanceof Response) error(auth.status, 'Admin access required.');
  const { types, locale } = await parent();
  const rt = runtime();
  const deployed = rt.services.deployed(auth.projectKey);
  const inDeployed = deployed?.config.file.types?.[params.type] !== undefined;
  if (!inDeployed && !types.some((t) => t.key === params.type)) error(404, 'Unknown feature type.');
  const page = loadDataPage(
    {
      deployedType: () => deployed?.config.file.types?.[params.type],
      deployedMap: () => deployed?.config.file.map,
      actors: actorSourcesOf,
      deployedRoles: () => deployed?.config.file.roles,
    },
    auth.projectKey,
    params.type,
  );
  // The CSV wizard's targets (S3-22): the deployed file when the type is deployed, else the draft (A4).
  const importing = loadImportSetup(
    { deployed: () => deployed?.config.file, draft: () => loadDraft(auth.projectKey) },
    params.type,
    locale,
  );
  // The Icons dialog opens with the look of the draft (v3 `iconConfig` and `filter_value_icons` of the workflow).
  const icons = loadIcons(auth.projectKey, params.type, locale);
  // The header (name, description, roles, shape, Private Einträge) reads the draft, as the sidebar's name does.
  const header = loadHeader(draftOrDeployed(auth.projectKey), auth.projectKey, params.type, locale);
  return { project: auth.projectKey, key: params.type, ...page, importing, icons, header };
};

// The Icons dialog's server side (v3 `updateIconConfig` and `updateFilterValueIcons`): the look of a type is config, so
// every edit is a builder Doc op on the project's draft (`@ueberblick/builder` icons ops) and the publish bar picks it up.
const REFUSAL: Record<IconErrorCode, AdminKey> = {
  unknown_type: 'icons_err_unknown_type',
  property_invalid: 'icons_err_property_invalid',
  no_property: 'icons_err_no_property',
  unknown_value: 'icons_err_unknown_value',
  invalid_svg: 'icons_err_invalid_svg',
  invalid_size: 'icons_err_invalid_size',
  invalid_color: 'icons_err_invalid_color',
  invalid_icon: 'icons_err_invalid_icon',
  problem: 'icons_err_problem',
  refused: 'icons_err_refused',
  no_version: 'icons_err_no_version',
  conflict: 'icons_err_conflict',
};

/** The look of one type in the draft (or, with no draft yet, as deployed); null when the project has neither. */
function loadIcons(projectKey: string, type: string, locale: Locale): IconsState | null {
  const source = draftOrDeployed(projectKey);
  return source === null || source.effective().types?.[type] === undefined
    ? null
    : iconsState(source, type, locale);
}

/** One refusal in both page languages, as the Rollen and Beziehungen pages answer. */
interface IconRefusal {
  readonly code: IconErrorCode;
  readonly message: { readonly de: string; readonly en: string };
}

type IconCallOutcome =
  { readonly ok: true; readonly state: IconsState } | ({ readonly ok: false } & IconRefusal);

const refusal = (code: IconErrorCode, detail?: string): IconCallOutcome => {
  const add = detail !== undefined && (code === 'problem' || code === 'invalid_svg') ? `: ${detail}` : '';
  return {
    ok: false,
    code,
    message: { de: adminMessage('de', REFUSAL[code]) + add, en: adminMessage('en', REFUSAL[code]) + add },
  };
};

/** One edit of the dialog, saved to the draft; answers with the dialog's state after it. */
function runIconCall(
  projectKey: string,
  principal: Principal,
  locale: Locale,
  type: string,
  call: IconCall,
): IconCallOutcome {
  const by = principal.id;
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, by);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) return refusal('no_version');
  const doc: Doc = openProject(sources.templateSrc, sources.overlaySrc);
  let edit: IconEdit;
  switch (call.action) {
    case 'property':
      edit = setClassifyProperty(doc, type, call.property, locale);
      break;
    case 'set_value':
      edit = setValueIcon(doc, type, call.value, call.look, locale);
      break;
    case 'clear_value':
      edit = clearValueIcon(doc, type, call.value, locale);
      break;
    case 'set_marker':
      edit = setMarker(doc, type, call.look, locale);
      break;
    case 'clear_marker':
      edit = clearMarker(doc, type, locale);
      break;
  }
  if (!edit.ok) return refusal(edit.code, edit.detail);
  if (edit.doc !== doc) {
    const saved = createDraftStore(rt.projectDb(projectKey)).putIf(
      ensured.draft.revision,
      edit.doc.save().overlaySrc,
      by,
      rt.clock.now(),
    );
    if (!saved.ok) return refusal('conflict');
    rt.previews.schedulePreviewRefresh(projectKey);
  }
  return { ok: true, state: iconsState(edit.doc, type, locale) };
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const ACTIONS = ['property', 'set_value', 'clear_value', 'set_marker', 'clear_marker'] as const;
const isCall = (b: unknown): b is IconCall =>
  typeof b === 'object' && b !== null && ACTIONS.some((a) => (b as { action?: unknown }).action === a);

export const actions: Actions = {
  /** v3 `?/updateIconConfig` and `?/updateFilterValueIcons`, as one draft edit of the type's look. */
  icons: async ({ locals, url, params, request, cookies }) => {
    adminOf(locals, url);
    const auth = authorizeAdmin(locals.admin, params.projectId);
    if (auth instanceof Response) error(auth.status, 'Admin access required.');
    const raw = (await request.formData()).get('call');
    const call: unknown = typeof raw === 'string' ? parseJson(raw) : null;
    if (!isCall(call)) return fail(400, { error: 'Expected { action, … }.' });
    const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
    const r = runIconCall(auth.projectKey, auth.principal, locale, params.type, call);
    return r.ok
      ? { state: r.state }
      : fail(r.code === 'conflict' ? 409 : 400, { code: r.code, message: r.message });
  },
  /** v3 `?/updateWorkflowMeta`, as one draft edit of the header: name, description, roles, Private Einträge and the shape. */
  header: async ({ locals, url, params, request, cookies }) => {
    adminOf(locals, url);
    const auth = authorizeAdmin(locals.admin, params.projectId);
    if (auth instanceof Response) error(auth.status, 'Admin access required.');
    const raw = (await request.formData()).get('call');
    const call: unknown = typeof raw === 'string' ? parseJson(raw) : null;
    if (!isHeaderCall(call)) return fail(400, { error: 'Expected { action, … }.' });
    const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
    return headerAnswer(runHeaderCall(auth.projectKey, auth.principal, locale, params.type, call));
  },
  /** v3's ⋮ menu (`?/duplicate`, `?/importFromProject`, `?/deleteWorkflow`): copy or remove an Objektart in the draft. */
  menu: async ({ locals, url, params, request, cookies }) => {
    adminOf(locals, url);
    const auth = authorizeAdmin(locals.admin, params.projectId);
    if (auth instanceof Response) error(auth.status, 'Admin access required.');
    const raw = (await request.formData()).get('call');
    const call: unknown = typeof raw === 'string' ? parseJson(raw) : null;
    if (!isMenuCall(call)) return fail(400, { error: 'Expected { action, … }.' });
    const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
    return menuAnswer(runMenuCall(auth.projectKey, auth.principal, locale, params.type, call));
  },
};
