/**
 * The browser side of the Projekteinstellungen page: one function per write over the page's own route, plus the icon
 * upload to the admin assets endpoint (A-036). Every answer is a `CallResult`: done, or the refusal already in the page
 * language, so a component shows a message and never reads a status.
 */
import type { LayerOp } from './layers-model';
import type { PackStatus } from '@ueberblick/server';
import type { InfoPageValues } from './info-pages';
import type { MapViewValues } from './map-view';
import type { FiltersData, PresetRef, PresetSave } from './presets-types';
import type { PackValues } from './packs';
import type { StartupValues } from './start-types';
import type {
  ApiTokenRow,
  CallResult,
  CreatedToken,
  DeleteCounts,
  ParticipantOption,
  SettingsCall,
  SettingsDocData,
  UploadedAsset,
} from './types';

export type Language = 'de' | 'en';
type Fetch = typeof fetch;

export interface SettingsApi {
  saveBranding(patch: { name?: string; icon?: string | null }): Promise<CallResult<SettingsDocData>>;
  saveMap(values: MapViewValues): Promise<CallResult<SettingsDocData>>;
  saveInfoPage(values: InfoPageValues): Promise<CallResult<SettingsDocData>>;
  deleteInfoPage(key: string): Promise<CallResult<SettingsDocData>>;
  savePack(values: PackValues): Promise<CallResult<SettingsDocData>>;
  savePackRoles(key: string, roles: readonly string[]): Promise<CallResult<SettingsDocData>>;
  deletePack(key: string): Promise<CallResult<SettingsDocData>>;
  /** The build state of the deployed packs (`GET /api/admin/p/<project>/packs`, A-032). */
  packStatuses(): Promise<CallResult<readonly PackStatus[]>>;
  /** Retries a failed pack (`POST .../packs/<key>/rebuild`). */
  rebuildPack(key: string): Promise<CallResult<unknown>>;
  /** The chat on or off, and the roles that have it (empty = all). */
  saveChat(values: { enabled: boolean; roles: readonly string[] }): Promise<CallResult<SettingsDocData>>;
  /** The template's inputs: the values to set (a value equal to the template's default clears the project's own). */
  saveTemplateInputs(values: Readonly<Record<string, unknown>>): Promise<CallResult<SettingsDocData>>;
  /** One edit of the Kartenebenen (add, update, remove, order): a draft op on `map.layers`. */
  saveLayers(op: LayerOp): Promise<CallResult<SettingsDocData>>;
  /** Uploads the icon's bytes; the sha then goes into `saveBranding({ icon })`. */
  uploadIcon(file: File): Promise<CallResult<UploadedAsset>>;
  /** The "API-Tokens" section (WP-388): QGIS / GIS tokens of the project's participants. */
  listTokens(): Promise<CallResult<readonly ApiTokenRow[]>>;
  createToken(input: {
    /** Exactly one of `participant` and `admin` (the issuing admin's own rights, WP-1070). */
    readonly participant?: string;
    readonly admin?: true;
    readonly label: string;
    /** An ISO instant; absent: the token does not expire. */
    readonly expiresAt?: string;
  }): Promise<CallResult<CreatedToken>>;
  revokeToken(id: string): Promise<CallResult<null>>;
  listParticipants(): Promise<CallResult<readonly ParticipantOption[]>>;
  /** The "Gefahrenzone" section (WP-388): what the dialog lists, and the delete itself (`confirm` is the typed project key). */
  deleteCounts(): Promise<CallResult<DeleteCounts>>;
  deleteProject(confirm: string): Promise<CallResult<null>>;
  /** Erststart (WP-386): the layers on at start. */
  saveStartup(values: StartupValues): Promise<CallResult<SettingsDocData>>;
  /** Cluster / Filter & Felder "Beim Start aktiv" for the roles (null: every role). */
  saveToolStart(
    tool: 'cluster' | 'field_filters',
    roles: readonly string[] | null,
    on: boolean,
  ): Promise<CallResult<SettingsDocData>>;
  savePreset(preset: PresetSave): Promise<CallResult<SettingsDocData>>;
  deletePreset(ref: PresetRef): Promise<CallResult<SettingsDocData>>;
  /** The roles, presets and the draft compiled for the filter builder; read when Filter & Felder opens. */
  loadFilters(): Promise<CallResult<FiltersData>>;
}

interface Refusal {
  readonly message?: { readonly de?: string; readonly en?: string };
  readonly error?: string | { readonly code?: string };
}

/** The upload's two typed refusals (HTTP 413 and 400) as page messages; anything else is the fallback. */
export interface UploadMessages {
  readonly tooLarge: string;
  readonly badType: string;
}

export function createSettingsApi(opts: {
  readonly project: string;
  readonly language: Language;
  readonly fetch: Fetch;
  /** The message when the server gave none (offline, a 500). */
  readonly fallback: string;
  readonly upload: UploadMessages & { readonly fallback: string };
}): SettingsApi {
  const project = encodeURIComponent(opts.project);
  const page = `/admin/projects/${project}/settings`;

  async function call(body: SettingsCall): Promise<CallResult<SettingsDocData>> {
    try {
      const res = await opts.fetch(page, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer: unknown = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, value: answer as SettingsDocData };
      return { ok: false, message: (answer as Refusal).message?.[opts.language] ?? opts.fallback };
    } catch {
      return { ok: false, message: opts.fallback };
    }
  }

  const packs = `/api/admin/p/${project}/packs`;

  /** A GET or POST of the packs endpoint: its refusals carry no page-language text, so the fallback says it. */
  async function packCall<T>(url: string, init?: RequestInit): Promise<CallResult<T>> {
    try {
      const res = await opts.fetch(url, init);
      if (res.ok) return { ok: true, value: (await res.json()) as T };
      return { ok: false, message: opts.fallback };
    } catch {
      return { ok: false, message: opts.fallback };
    }
  }
  const admin = `/api/admin/p/${project}`;
  /** One JSON call to an admin endpoint: the answer's body, or the fallback message (the section words its own error). */
  async function plain<T>(
    url: string,
    init: RequestInit,
    read: (body: unknown) => T,
  ): Promise<CallResult<T>> {
    try {
      const res = await opts.fetch(url, init);
      if (!res.ok) return { ok: false, message: opts.fallback };
      const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
      return { ok: true, value: read(body) };
    } catch {
      return { ok: false, message: opts.fallback };
    }
  }
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    listTokens: () => plain(`${admin}/tokens`, {}, (b) => (b as { tokens: readonly ApiTokenRow[] }).tokens),
    createToken: (input) => plain(`${admin}/tokens`, json('POST', input), (b) => b as CreatedToken),
    revokeToken: (id) => plain(`${admin}/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }, () => null),
    listParticipants: () =>
      plain(
        `${admin}/participants?guests=true`,
        {},
        (b) => (b as { participants: readonly ParticipantOption[] }).participants,
      ),
    deleteCounts: () => plain(`/api/admin/projects/${project}`, {}, (b) => b as DeleteCounts),
    deleteProject: (confirm) =>
      plain(`/api/admin/projects/${project}`, json('DELETE', { confirm }), () => null),
    saveInfoPage: (values) => call({ action: 'info_page', ...values }),
    deleteInfoPage: (key) => call({ action: 'info_page_delete', key }),
    savePack: (values) => call({ action: 'pack', ...values }),
    savePackRoles: (key, roles) => call({ action: 'pack_roles', key, roles }),
    deletePack: (key) => call({ action: 'pack_delete', key }),
    async packStatuses() {
      const r = await packCall<{ packs: readonly PackStatus[] }>(packs);
      return r.ok ? { ok: true, value: r.value.packs } : r;
    },
    rebuildPack: (key) => packCall(`${packs}/${encodeURIComponent(key)}/rebuild`, { method: 'POST' }),
    saveBranding: (patch) => call({ action: 'branding', ...patch }),
    saveMap: (values) => call({ action: 'map', ...values }),
    saveChat: (values) => call({ action: 'chat', ...values }),
    saveTemplateInputs: (values) => call({ action: 'template_inputs', values }),
    saveLayers: (op) => call({ action: 'layers', ...op }),
    saveStartup: (values) => call({ action: 'startup', ...values }),
    saveToolStart: (tool, roles, on) => call({ action: tool, roles, on }),
    savePreset: (preset) => call({ action: 'preset_save', preset }),
    deletePreset: (ref) => call({ action: 'preset_delete', ref }),
    async loadFilters() {
      try {
        const res = await opts.fetch(`${page}/filters`);
        const answer: unknown = await res.json().catch(() => ({}));
        if (res.ok) return { ok: true, value: answer as FiltersData };
        return { ok: false, message: (answer as Refusal).message?.[opts.language] ?? opts.fallback };
      } catch {
        return { ok: false, message: opts.fallback };
      }
    },
    async uploadIcon(file) {
      try {
        const res = await opts.fetch(`/api/admin/p/${project}/assets`, {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file,
        });
        if (res.ok) return { ok: true, value: (await res.json()) as UploadedAsset };
        const code = ((await res.json().catch(() => ({}))) as Refusal).error;
        const text =
          res.status === 413
            ? opts.upload.tooLarge
            : typeof code === 'object' && code?.code === 'invalid_body'
              ? opts.upload.badType
              : opts.upload.fallback;
        return { ok: false, message: text };
      } catch {
        return { ok: false, message: opts.upload.fallback };
      }
    },
  };
}
