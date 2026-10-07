/** The plain-words text of one diff line and of the element a mapping is about (WP-360). */
import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import type { OrderedMap } from '@ueberblick/core/registry/compile';
import { nounOf } from './entity-path';
import type { PlanEntry } from './types';

const NOUNS: Readonly<Record<string, AdminKey>> = {
  type: 'deploy_noun_type',
  property: 'deploy_noun_property',
  relation: 'deploy_noun_relation',
  option: 'deploy_noun_option',
  stage: 'deploy_noun_stage',
  tasks: 'deploy_noun_tasks',
  auto: 'deploy_noun_auto',
  roles: 'deploy_noun_roles',
  views: 'deploy_noun_views',
  tools: 'deploy_noun_tools',
  inputs: 'deploy_noun_inputs',
};

const LINES: Readonly<Record<PlanEntry['change'], AdminKey>> = {
  added: 'deploy_line_added',
  removed: 'deploy_line_removed',
  changed: 'deploy_line_changed',
  order_changed: 'deploy_line_order_changed',
};

/** What an ordered map holds, as "Reihenfolge {what} geändert" reads it; typed over the registry, so a new map needs a word. */
const ORDER_OF: Readonly<Record<OrderedMap, AdminKey>> = {
  types: 'deploy_order_of_types',
  tasks: 'deploy_order_of_tasks',
  views: 'deploy_order_of_views',
  roles: 'deploy_order_of_roles',
  'types.*.properties': 'deploy_order_of_properties',
  'types.*.relations': 'deploy_order_of_relations',
  'types.*.properties.*.options': 'deploy_order_of_options',
  'tasks.*.form': 'deploy_order_of_form',
  'tasks.*.auto': 'deploy_order_of_auto',
  'roles.*.app.views': 'deploy_order_of_views',
  'roles.*.app.shortcuts': 'deploy_order_of_shortcuts',
  'roles.*.app.tools': 'deploy_order_of_tools',
  'roles.*.app.filter_presets': 'deploy_order_of_filter_presets',
  'views.*.layers': 'deploy_order_of_layers',
  'map.layers': 'deploy_order_of_layers',
  'map.packs': 'deploy_order_of_packs',

  tools: 'deploy_order_of_tools',
  info_pages: 'deploy_order_of_info_pages',
};

/** "Phase", "Option", "Aufgabe" ... for the element at `path`. */
export const nounText = (locale: Locale, path: string, stage: boolean): string =>
  adminMessage(locale, NOUNS[nounOf(path, stage)] ?? 'deploy_noun_other');

/** "Phase „Maßnahme“ entfernt". */
export function lineText(locale: Locale, e: PlanEntry): string {
  if (e.order !== undefined) {
    const what = adminMessage(locale, ORDER_OF[e.order.map]);
    return e.order.owner === null
      ? adminMessage(locale, 'deploy_line_order_changed_all', { what })
      : adminMessage(locale, 'deploy_line_order_changed', {
          noun: nounText(locale, e.order.owner, false),
          name: e.name,
          what,
        });
  }
  return adminMessage(locale, LINES[e.change], {
    noun: nounText(locale, e.path, e.stage === true),
    name: e.name,
  });
}
