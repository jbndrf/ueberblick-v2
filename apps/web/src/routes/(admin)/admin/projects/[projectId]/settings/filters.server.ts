/**
 * What the Filter & Felder section loads when it opens (WP-386): the roles, the presets with their condition counts,
 * and the draft compiled for the filter builder (it offers the types, fields and stages of the draft, as the
 * participant's builder does with the deployed config). A draft that does not compile cannot be offered to the builder.
 */
import { builderContext, filterToClauses } from '@ueberblick/core/filters';
import { compile, NO_ASSETS, serialize, localize } from '@ueberblick/core';
import type { Key } from '@ueberblick/core/model';
import type { FiltersData } from '../../../../../../lib/admin/settings/presets-types';
import { presetRows } from './presets-doc';
import { effectiveFile } from './settings.server';

export type FiltersLoad =
  | { readonly ok: true; readonly data: FiltersData }
  | { readonly ok: false; readonly code: 'no_version' | 'problems'; readonly detail?: string };

export function loadFilters(projectKey: string, locale: string): FiltersLoad {
  const file = effectiveFile(projectKey);
  if (file === null) return { ok: false, code: 'no_version' };
  const compiled = compile(file, { assets: NO_ASSETS });
  if (!compiled.ok) {
    const first = compiled.problems[0];
    return {
      ok: false,
      code: 'problems',
      ...(first ? { detail: `${first.path}: ${localize(first.message, [locale])}` } : {}),
    };
  }
  const config = compiled.config;
  const roleKeys = Object.keys(file.roles ?? {}).map((r) => r as Key);
  const types = builderContext(config, { id: 'admin', kind: 'participant', roles: roleKeys }, locale).types;
  return {
    ok: true,
    data: {
      roles: Object.entries(file.roles ?? {}).map(([key, role]) => ({
        key,
        label: localize(role.label, [locale]) || key,
      })),
      presets: presetRows(file, locale, (filters) => filterToClauses(config, filters, types).length),
      config: serialize(config),
    },
  };
}
