import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { createReader } from '../../reader';
import { createGeo } from '@ueberblick/core/geo';
import { createDeviceIds } from '../../ids';
import { creatablePills, placementOf, pointAt } from './creatable';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const at = () => '2026-09-30T10:00:00.000Z' as never;
const none = {
  feature: () => undefined,
  near: () => [],
  ofType: () => [],
  edgesFrom: () => [],
  edgesTo: () => [],
  history: () => [],
  observationsByActor: () => [],
  createdBy: () => 0,
  featuresWith: () => [],
};
const startableFor = (roles: string[]): readonly string[] =>
  createReader({
    facts: none,
    versions: { deployed: 1, get: () => config },
    bootstrapVersion: 1,
    actor: { id: 'anna', kind: 'participant', roles: roles as Key[] },
    geo: createGeo(),
    clock: { now: at },
    ids: createDeviceIds({ now: at }, (n) => new Uint8Array(n)),
    locale: 'de',
    actorName: 'Anna Beispiel',
    activity: {
      activityWarm: () => false,
      warmActivity: () => Promise.resolve(),
      observationsOf: () => [],
      runMeta: () => undefined,
      personName: () => undefined,
      queuedRunsOf: () => [],
      plannedChangesOf: () => [],
    },
  }).startableTasks();

const pills = (roles: string[], locale = 'de') =>
  creatablePills({ config, startable: startableFor(roles), locale });

describe('creatablePills', () => {
  it('lists exactly the creatable types of the role (the device reader decides), labelled with the task label', () => {
    expect(pills(['kontrolle']).map((p) => [p.taskKey, p.label])).toEqual([['erfassen', 'Baum erfassen']]);
    expect(pills(['bauhof'])).toEqual([]);
  });

  it('uses the language of the person', () => {
    expect(pills(['kontrolle'], 'en')[0]?.label).toBe('Record tree');
  });

  it('a point type is placed on the map, a type without geometry opens the form at once', () => {
    const p = pills(['verwaltung']);
    expect(p.find((x) => x.taskKey === 'erfassen')?.onMap).toBe(true);
    expect(p.find((x) => x.taskKey === 'baumart_anlegen')?.onMap).toBe(false);
  });

  it('a type drawn as an area is offered and drawn on the map, not placed with the pin', () => {
    expect(placementOf(config, 'flaeche')).toEqual({ onMap: false, draw: { kind: 'polygon', multi: false } });
    const pill = pills(['verwaltung']).find((x) => x.taskKey === 'flaeche_anlegen');
    expect(pill).toMatchObject({ onMap: false, draw: { kind: 'polygon', multi: false } });
  });

  it('the declared geometry type decides the kind and whether several parts are allowed', () => {
    const cfg = (geometry_type: string) =>
      ({
        file: { types: { t: { properties: { g: { type: 'geometry', geometry_type } } } } },
        foldTypes: new Map([['t', { primaryGeometry: 'g' }]]),
      }) as never;
    expect(placementOf(cfg('linestring'), 't').draw).toEqual({ kind: 'linestring', multi: false });
    expect(placementOf(cfg('multilinestring'), 't').draw).toEqual({ kind: 'linestring', multi: true });
    expect(placementOf(cfg('multipolygon'), 't').draw).toEqual({ kind: 'polygon', multi: true });
    expect(placementOf(cfg('point'), 't')).toEqual({ onMap: true });
  });

  it('only tasks that start without a feature are pills (tasks on a feature live on its sheet)', () => {
    const forged = creatablePills({ config, startable: ['kontrolle', 'erfassen'], locale: 'de' });
    expect(forged.map((x) => x.taskKey)).toEqual(['erfassen']);
  });

  it('v3 rule: every entry task the role may start is a pill, also one with no geometry (`on: $none`)', () => {
    // v3 +page.svelte:775-795 `creatableWorkflows` = workflows with a deployed entry task and an allowed role, whatever
    // their geometry; WorkflowSelector.svelte:154-170 sent a non-incident one straight to the form (no placement).
    const none = pills(['verwaltung']).find((x) => x.taskKey === 'baumart_anlegen');
    expect(config.file.tasks?.['baumart_anlegen']?.on).toBe('$none');
    expect(none).toMatchObject({ label: 'Baumart anlegen', onMap: false });
    expect(none?.draw).toBeUndefined();
  });

  it('a placed pin gives a GeoJSON point [lon, lat]', () => {
    expect(pointAt(7.1, 50.7)).toEqual({ type: 'Point', coordinates: [7.1, 50.7] });
  });
});

describe('creatablePills: the parent link (WP-677, B-019)', () => {
  const FILE = {
    types: {
      gebiet: {
        label: 'G',
        properties: { n: { type: 'text' } },
        relations: { b: { to: 'baum', inverse_of: 'baum.gebiet' } },
      },
      baum: {
        label: 'B',
        properties: {
          st: { type: 'geometry', geometry_type: 'point' },
          gebiet: { type: 'reference', to: 'gebiet' },
        },
        geometry: 'st',
        relations: { m: { to: 'massnahme', inverse_of: 'massnahme.baum', inherit_position: true } },
      },
      massnahme: { label: 'M', properties: { baum: { type: 'reference', to: 'baum' } } },
    },
    tasks: {
      baum_neu: { label: 'Baum neu', on: '$map', creates: 'baum' },
      mass_neu: { label: 'Maßnahme neu', on: '$none', creates: 'massnahme' },
    },
  };
  const cfg = {
    file: FILE,
    foldTypes: new Map([
      ['baum', { primaryGeometry: 'st' }],
      ['massnahme', {}],
      ['gebiet', {}],
    ]),
  } as never;
  const list = creatablePills({ config: cfg, startable: ['baum_neu', 'mass_neu'], locale: 'de' });

  it('a point type with an optional parent offers the chain while it is placed', () => {
    expect(list.find((p) => p.taskKey === 'baum_neu')?.chain).toEqual({
      relations: [{ property: 'gebiet', parentType: 'gebiet' }],
      inherit: false,
    });
  });
  it('a type that sits at its parent has no pin: its pill picks the parent', () => {
    const pill = list.find((p) => p.taskKey === 'mass_neu');
    expect(pill?.onMap).toBe(false);
    expect(pill?.chain?.inherit).toBe(true);
  });
  it('the golden baumkataster pills carry no chain (no hierarchy)', () => {
    expect(pills(['verwaltung']).every((p) => p.chain === undefined)).toBe(true);
  });
});
