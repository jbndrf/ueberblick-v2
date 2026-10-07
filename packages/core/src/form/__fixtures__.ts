/** A small project with a task form that uses every ODK attribute, and an eval context over it. */
import { createGeo } from '../geo';
import type { EvalContext } from '../expr/contract';
import type { FeatureId, Json } from '../model';
import { compile } from '../schema/compile';
import type { CompiledConfig } from '../schema/compile/contract';
import { TemplateFileSchema } from '../schema/file';
import { goldenAssets } from '../testing/golden';

export const NOW = '2026-09-29T12:00:00.000Z';

export const FILE = {
  schema: 'ueberblick/1',
  template: { key: 'formtest', version: '1.0.0' },
  roles: { kontrolle: { label: { de: 'Kontrolle' } } },
  types: {
    baum: {
      label: { de: 'Baum' },
      properties: {
        vitalitaet: { type: 'text' },
        befund: { type: 'text' },
        foto: { type: 'text' },
        hoehe_m: { type: 'number' },
        hoehe_klasse: { type: 'text' },
        notiz: { type: 'text' },
        grund: { type: 'text' },
        zaehler: { type: 'number' },
        art: { type: 'select', options: { eiche: 'Eiche', linde: 'Linde' } },
        arten: { type: 'multiselect', options: { eiche: 'Eiche', linde: 'Linde' } },
        stamm: { type: 'integer', min: 1, max: 9 },
        offen: { type: 'boolean' },
        am: { type: 'date' },
        wann: { type: 'datetime' },
        geom: { type: 'geometry', geometry_type: 'point' },
        anhang: { type: 'file' },
        titel: { type: 'localized_text' },
        name: { type: 'integer' },
        p_a: { type: 'number' },
        p_b: { type: 'number' },
        p_c: { type: 'number' },
        meta: { type: 'geometry' },
      },
    },
    flaeche: { label: { de: 'Fläche' }, properties: { name: { type: 'text' } } },
  },
  tasks: {
    kontrolle: {
      label: { de: 'Kontrolle' },
      on: 'baum',
      form: {
        vitalitaet: { calculate: 'self.vitalitaet', required: true },
        befund: {
          required: true,
          constraint: 'value != self.befund',
          constraint_message: { de: 'Befund muss sich ändern', en: 'The finding must change' },
        },
        foto: { relevant: "form.vitalitaet >= 'v3'" },
        hoehe_m: {
          constraint: 'value > 0 && value < 60',
          constraint_message: { de: 'Höhe zwischen 0 und 60 m' },
        },
        hoehe_klasse: {
          readonly: true,
          calculate:
            "form.hoehe_m == null ? '' : (form.hoehe_m < 10 ? 'klein' : (form.hoehe_m < 25 ? 'mittel' : 'gross'))",
        },
        notiz: { required: "form.hoehe_klasse == 'gross'" },
        grund: { relevant: "form.hoehe_klasse == 'gross'", required: true },
        zaehler: { calculate: 'has(form.zaehler) ? form.zaehler : 1' },
      },
    },
    kaputt: {
      label: { de: 'Kaputt' },
      on: 'baum',
      form: {
        befund: { relevant: '1 / 0 == 1' },
      },
    },
    typen: {
      label: { de: 'Typen' },
      on: 'baum',
      form: Object.fromEntries(
        ['art', 'arten', 'stamm', 'offen', 'am', 'wann', 'geom', 'anhang', 'titel', 'hoehe_m'].map((k) => [
          k,
          {},
        ]),
      ),
    },
    zwei: { label: { de: 'Zwei' }, on: ['baum', 'flaeche'], form: { name: {} } },
    neu: { label: { de: 'Neu' }, on: '$map', creates: 'flaeche', form: { name: {} } },
    // readonly a reads readonly b (declared later), which reads the input c
    kette: {
      label: { de: 'Kette' },
      on: 'baum',
      form: {
        p_a: { readonly: true, calculate: 'form.p_b + 1' },
        p_b: { readonly: true, calculate: 'form.p_c * 2' },
        p_c: {},
      },
    },
    zyklus: {
      label: { de: 'Zyklus' },
      on: 'baum',
      form: {
        p_a: { readonly: true, calculate: 'form.p_b + 1' },
        p_b: { readonly: true, calculate: 'form.p_a + 1' },
      },
    },
    fehler: {
      label: { de: 'Fehler' },
      on: 'baum',
      form: {
        p_a: { required: '1 / 0 == 1' },
        p_b: { readonly: '1 / 0 == 1', calculate: 'form.p_c' },
        p_c: { readonly: true, calculate: '1 / 0' },
      },
    },
    objekt: {
      label: { de: 'Objekt' },
      on: 'baum',
      form: { meta: { readonly: true, calculate: "{'type': 'Point', 'coordinates': [1, 2]}" } },
    },
    leer: { label: { de: 'Leer' }, on: 'baum' },
  },
};

export function world(file: unknown = FILE): CompiledConfig {
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(`fixture does not compile: ${JSON.stringify(r.problems)}`);
  return r.config;
}

/** A context with `self` (a baum with the given properties) and an actor. */
export function ctx(config: CompiledConfig, self: Readonly<Record<string, Json>> = {}): EvalContext {
  const id = 'b1' as FeatureId;
  return {
    vars: new Map<string, Json | { $feature: FeatureId }>([
      ['self', { $feature: id }],
      ['actor', { id: 'u1', role: 'kontrolle', roles: ['kontrolle'] }],
    ]),
    features: {
      property: (f, k) => (f === id ? self[k] : undefined),
      related: () => [],
      history: () => [],
      type: () => 'baum' as never,
    },
    now: NOW,
    relations: config.relations,
    geo: createGeo(),
  };
}
