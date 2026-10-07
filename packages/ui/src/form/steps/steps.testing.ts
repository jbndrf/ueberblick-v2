import { compile } from '@ueberblick/core/compile';
import type { CompiledConfig, Key, Property, Task } from '@ueberblick/core/model';
import { TemplateFileSchema } from '@ueberblick/core/schema';
import { goldenAssets } from '@ueberblick/core/testing';
import { evalContext } from '../form.testing';
import type { Json } from '../contract';
import type { StepLabels } from './contract';
import { buildStepViews } from './views';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;

/** Properties of the test Objektart: a tree with a care form, a quick-edit pair and a point. */
export const properties: Record<string, Property> = {
  befund: P('text', { label: 'Befund' }),
  art: P('text', { label: 'Art' }),
  hoehe: P('number', { label: 'Höhe' }),
  lage: P('geometry', { label: 'Lage', geometry_type: 'point' }),
};

export const TASK = 'pflege' as Key;

/** A multi-step task over `properties`, compiled like any project file. */
export function stepsWorld(def: Pick<Task, 'form' | 'steps'>): { config: CompiledConfig; def: typeof def } {
  const file = {
    schema: 'ueberblick/1',
    template: { key: 'steps', version: '1.0.0' },
    roles: { kontrolle: { label: { de: 'Kontrolle' } } },
    types: {
      baum: {
        label: { de: 'Baum' },
        geometry: 'lage',
        properties: { ...properties, pruefer: { type: 'reference', to: 'person' } },
      },
      person: { label: { de: 'Prüfer' }, properties: { name: { type: 'text' } } },
    },
    tasks: { [TASK]: { label: { de: 'Pflege' }, on: 'baum', bind: { ref: 'self.pruefer' }, ...def } },
  };
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(`test task does not compile: ${JSON.stringify(r.problems)}`);
  return { config: r.config, def };
}

/** The step views of such a task, with the feature's current values. */
export function viewsOf(
  def: Pick<Task, 'form' | 'steps'>,
  current: Record<string, Json> = {},
  bound?: Parameters<typeof buildStepViews>[0]['bound'],
) {
  const { config } = stepsWorld(def);
  return buildStepViews({
    task: TASK,
    def,
    properties,
    config,
    ctx: evalContext(config, current as Parameters<typeof evalContext>[1]),
    locale: 'de',
    current,
    ...(bound === undefined ? {} : { bound }),
  });
}

export const point = (x: number): Json => ({ type: 'Point', coordinates: [x, 50] });

/** The strings of the flow as the app's German catalogue gives them. */
export const labels: StepLabels = {
  step: (c, t) => `Schritt ${c} von ${t}`,
  back: 'Zurück',
  cancel: 'Abbrechen',
  next: 'Weiter',
  submit: 'Absenden',
  locationUnset: 'Noch kein Standort gewählt',
  locationSet: 'Standort gewählt',
  locationPick: 'Standort auf der Karte wählen',
  locationUnavailable: 'Die Karte ist hier nicht verfügbar.',
  savedOnline: 'Gespeichert, wird gesendet.',
  savedOffline: 'Gespeichert, wird gesendet sobald online.',
  saveFailed: 'Nicht gespeichert.',
  accepted: 'Angenommen.',
  refused: (r) => `Abgelehnt: ${r}`,
  reopen: 'Erneut bearbeiten',
  close: 'Schließen',
};
