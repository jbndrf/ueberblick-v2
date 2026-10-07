import { json, type RequestHandler } from '@sveltejs/kit';
import { BlobShaSchema } from '@ueberblick/core';
import { readLayerOp } from './layers-call';
import { runSettingsCall } from './settings.server';
import type { SettingsErrorCode } from './settings-doc';
import type { SettingsCall } from '../../../../../../lib/admin/settings/types';
import { readStartCall } from './settings-call';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { adminMessage, type AdminKey } from '../../../shell/messages';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';

const REFUSAL: Record<SettingsErrorCode, AdminKey> = {
  invalid: 'settings_err_invalid',
  layer_invalid: 'settings_layers_err_invalid',
  no_layer: 'settings_layers_err_no_layer',
  layer_in_pack: 'settings_layers_err_in_pack',
  refused: 'settings_err_refused',
  no_version: 'settings_err_no_version',
  conflict: 'settings_err_conflict',
  not_found: 'settings_err_not_found',
  name_missing: 'settings_err_name_missing',
  roles_missing: 'settings_err_roles_missing',
  key_taken: 'settings_err_key_taken',
};

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
const KEY = /^[a-z][a-z0-9_]*$/;
const keyOf = (v: unknown): string | null => (typeof v === 'string' && KEY.test(v) ? v : null);

/** `[west, south, east, north]` as four finite numbers, or null. */
function boundsOf(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n)))
    return null;
  return v as [number, number, number, number];
}

/** The calls on info pages and packs; a wrong shape is null (a value out of range is the document's refusal). */
function readEntryCall(b: Record<string, unknown>): SettingsCall | null {
  switch (b['action']) {
    case 'info_page': {
      const title = str(b['title']);
      const content = str(b['content']);
      const key = b['key'] === undefined ? undefined : keyOf(b['key']);
      if (title === null || content === null || key === null) return null;
      return {
        action: 'info_page',
        ...(key === undefined ? {} : { key }),
        title,
        content,
        sortOrder: num(b['sortOrder']),
      };
    }
    case 'info_page_delete': {
      const key = keyOf(b['key']);
      return key === null ? null : { action: 'info_page_delete', key };
    }
    case 'pack': {
      const name = str(b['name']);
      const bounds = boundsOf(b['bounds']);
      const layers = strings(b['layers']);
      const roles = strings(b['roles']);
      const key = b['key'] === undefined ? undefined : keyOf(b['key']);
      if (name === null || bounds === null || layers === null || roles === null || key === null) return null;
      if (![...layers, ...roles].every((k) => KEY.test(k))) return null;
      return {
        action: 'pack',
        ...(key === undefined ? {} : { key }),
        name,
        minZoom: num(b['minZoom']),
        maxZoom: num(b['maxZoom']),
        bounds,
        layers,
        roles,
      };
    }
    case 'pack_roles': {
      const key = keyOf(b['key']);
      const roles = strings(b['roles']);
      if (key === null || roles === null || !roles.every((k) => KEY.test(k))) return null;
      return { action: 'pack_roles', key, roles };
    }
    case 'pack_delete': {
      const key = keyOf(b['key']);
      return key === null ? null : { action: 'pack_delete', key };
    }
    default:
      return null;
  }
}

/** The body as a call, or null when its shape is wrong (a value out of range is the Doc layer's refusal, not this). */
function readCall(body: unknown): SettingsCall | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b['action'] === 'branding') {
    const { name, icon } = b;
    if (name !== undefined && typeof name !== 'string') return null;
    if (icon !== undefined && icon !== null && !BlobShaSchema.safeParse(icon).success) return null;
    return {
      action: 'branding',
      ...(name === undefined ? {} : { name }),
      ...(icon === undefined ? {} : { icon: icon as string | null }),
    };
  }
  if (b['action'] === 'map')
    return {
      action: 'map',
      lat: num(b['lat']),
      lng: num(b['lng']),
      zoom: num(b['zoom']),
      minZoom: num(b['minZoom']),
      maxZoom: num(b['maxZoom']),
    };
  if (b['action'] === 'chat') {
    const { enabled, roles } = b;
    if (typeof enabled !== 'boolean') return null;
    if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string')) return null;
    return { action: 'chat', enabled, roles: roles as string[] };
  }
  if (b['action'] === 'template_inputs') {
    const { values } = b;
    if (typeof values !== 'object' || values === null || Array.isArray(values)) return null;
    return { action: 'template_inputs', values: values as Record<string, unknown> };
  }
  if (b['action'] === 'layers') {
    const op = readLayerOp(b);
    return op === null ? null : { action: 'layers', ...op };
  }
  return readEntryCall(b) ?? readStartCall(b);
}

/**
 * v3's `updateDisplayName`, `updateAppIcon`, `removeAppIcon` and `saveDefaults` actions as one admin route: Branding
 * and the Standardansicht are part of the project file, so each call is a Doc edit on the draft (WP-375). The refusal
 * comes in both page languages, as on the Rollen page.
 */
export const POST: RequestHandler = async ({ request, params, locals, cookies }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, { status: 403 });
  const call = readCall(await request.json().catch(() => null));
  if (call === null)
    return json(
      {
        error:
          'Expected { action: branding | map | layers | chat | template_inputs | info_page | info_page_delete | pack | pack_roles | pack_delete | startup | cluster | field_filters | preset_save | preset_delete, … }.',
      },
      { status: 400 },
    );
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const r = runSettingsCall(auth.projectKey, auth.principal, locale, call);
  if (r.ok) return json(r.body);
  const key = r.layer ? (`settings_layers_err_${r.layer}` as AdminKey) : REFUSAL[r.code];
  const detail = r.detail ? { detail: r.detail } : {};
  const text = (l: 'de' | 'en') =>
    adminMessage(l, key) + (r.code === 'refused' && r.detail ? `: ${r.detail}` : '');
  return json(
    {
      error: r.code,
      ...detail,
      ...(r.fields ? { fields: r.fields } : {}),
      message: { de: text('de'), en: text('en') },
    },
    { status: r.code === 'conflict' ? 409 : 400 },
  );
};
