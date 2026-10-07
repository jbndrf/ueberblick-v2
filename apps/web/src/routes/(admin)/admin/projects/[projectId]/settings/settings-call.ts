/** The shape check of the WP-386 settings calls (what the browser may send); the Doc layer decides what is allowed. */
import type { TypeStart } from '../../../../../../lib/admin/settings/start-types';
import type { SettingsCall } from '../../../../../../lib/admin/settings/types';

const isTexts = (v: unknown): v is string[] => Array.isArray(v) && v.every((e) => typeof e === 'string');
const isRecordOfTexts = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((e) => typeof e === 'string');

/** The body as a startup, tool or preset call, or null when its shape is wrong. */
export function readStartCall(b: Record<string, unknown>): SettingsCall | null {
  switch (b['action']) {
    case 'startup': {
      const { base, overlays, types } = b;
      if (base !== null && typeof base !== 'string') return null;
      if (!isTexts(overlays)) return null;
      if (typeof types !== 'object' || types === null || Array.isArray(types)) return null;
      const read: Record<string, TypeStart> = {};
      for (const [key, v] of Object.entries(types)) {
        if (typeof v !== 'object' || v === null) return null;
        const { on, values } = v as Record<string, unknown>;
        if (typeof on !== 'boolean' || (values !== null && !isTexts(values))) return null;
        read[key] = { on, values };
      }
      return { action: 'startup', base, overlays, types: read };
    }
    case 'cluster':
    case 'field_filters': {
      const { roles, on } = b;
      if (typeof on !== 'boolean') return null;
      if (roles !== null && !isTexts(roles)) return null;
      return { action: b['action'], roles, on };
    }
    case 'preset_save': {
      const p = b['preset'];
      if (typeof p !== 'object' || p === null) return null;
      const { name, roles, filters, key, was } = p as Record<string, unknown>;
      if (typeof name !== 'string' || !isTexts(roles) || !isRecordOfTexts(filters)) return null;
      if (key !== undefined && typeof key !== 'string') return null;
      if (was !== undefined && !isTexts(was)) return null;
      return {
        action: 'preset_save',
        preset: {
          name,
          roles,
          filters,
          ...(key === undefined ? {} : { key }),
          ...(was === undefined ? {} : { was }),
        },
      };
    }
    case 'preset_delete': {
      const r = b['ref'];
      if (typeof r !== 'object' || r === null) return null;
      const { key, roles } = r as Record<string, unknown>;
      if (typeof key !== 'string' || !isTexts(roles)) return null;
      return { action: 'preset_delete', ref: { key, roles } };
    }
    default:
      return null;
  }
}
