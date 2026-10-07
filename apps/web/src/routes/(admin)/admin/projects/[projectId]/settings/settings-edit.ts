/** Which Doc edit a settings call is (WP-375, WP-386): one place that maps a call to the headless edit of its section. */
import type { Doc } from '@ueberblick/builder';
import type { SettingsCall } from '../../../../../../lib/admin/settings/types';
import { setChat } from './chat-doc';
import { applyLayerOp } from './layers-doc';
import { deletePreset, savePreset } from './presets-doc';
import { deleteInfoPage, deletePack, setInfoPage, setPack, setPackRoles } from './settings-entries';
import { setBranding, setMapView, type SettingsEdit } from './settings-doc';
import { setTemplateInputs } from './template-doc';
import { CLUSTER_TOOL, FILTER_VIEWS_TOOL, setStartup, setToolStart } from './start-doc';

export function editFor(doc: Doc, call: SettingsCall, locale: string): SettingsEdit {
  switch (call.action) {
    case 'branding':
      return setBranding(
        doc,
        {
          ...(call.name === undefined ? {} : { name: call.name }),
          ...(call.icon === undefined ? {} : { icon: call.icon }),
        },
        locale,
      );
    case 'map':
      return setMapView(doc, call);
    case 'chat':
      return setChat(doc, call);
    case 'template_inputs':
      return setTemplateInputs(doc, call.values);
    case 'layers':
      return applyLayerOp(doc, call, locale);
    case 'info_page':
      return setInfoPage(doc, call, locale);
    case 'info_page_delete':
      return deleteInfoPage(doc, call.key);
    case 'pack':
      return setPack(doc, call, locale);
    case 'pack_roles':
      return setPackRoles(doc, call.key, call.roles);
    case 'pack_delete':
      return deletePack(doc, call.key);
    case 'startup':
      return setStartup(doc, call);
    case 'cluster':
      return setToolStart(doc, CLUSTER_TOOL, call.roles, call.on);
    case 'field_filters':
      return setToolStart(doc, FILTER_VIEWS_TOOL, call.roles, call.on);
    case 'preset_save':
      return savePreset(doc, call.preset, locale);
    case 'preset_delete':
      return deletePreset(doc, call.ref);
  }
}
