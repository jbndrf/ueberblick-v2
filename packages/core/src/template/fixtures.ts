/** Small template and overlay builders shared by the template specs. */
import type { OverlayFile, TemplateFile } from '../schema';

export const template1: TemplateFile = {
  schema: 'ueberblick/1',
  template: { key: 'baumkataster', version: '1.0.0' },
  inputs: { intervall: { type: 'integer', default: 12, label: 'Intervall' } },
  lock: ['types.baum.properties.stage.options'],
  roles: {
    kontrolle: {
      label: 'Kontrolle',
      app: { home: 'karte', views: { karte: {} }, tools: { photo: {} }, shortcuts: { melden: {} } },
    },
  },
  types: {
    baum: {
      label: 'Baum',
      geometry: 'point',
      properties: {
        stage: { type: 'select', options: { erfasst: 'Erfasst', erledigt: 'Erledigt' } },
        vitalitaet: { type: 'select', label: 'Vitalitaet', options: { '0': '0', '1': '1' } },
        befund: { type: 'text', label: 'Befund' },
      },
      permissions: { see: 'all', write: { vitalitaet: ['kontrolle'] } },
    },
  },
  tasks: {
    melden: {
      label: 'Melden',
      on: 'baum',
      form: { befund: {} },
      auto: { nachkontrolle: { after: 'kontrolle' } },
    },
    kontrolle: { label: 'Kontrolle', on: 'baum', form: { vitalitaet: {} } },
  },
  views: { karte: { source: { type: 'baum' }, sort: ['-vitalitaet'] } },
  tools: { photo: {} },
};

export const emptyOverlay: OverlayFile = { schema: 'ueberblick/1', extends: 'baumkataster@1' };

export const overlay = (over: Partial<OverlayFile>): OverlayFile => ({ ...emptyOverlay, ...over });

/** Deep copy with a change applied by `edit`. */
export function edited(t: TemplateFile, edit: (copy: TemplateFile) => void, version?: string): TemplateFile {
  const copy = structuredClone(t);
  edit(copy);
  if (version) copy.template = { ...copy.template, version };
  return copy;
}
