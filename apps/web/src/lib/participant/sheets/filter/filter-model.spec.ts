import { describe, expect, it } from 'vitest';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { buildCards, deviceFilterData } from './filter-model';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const f = (id: string, type: string, props: Record<string, unknown>): FeatureState =>
  ({ id, type: type as Key, properties: props, lifecycle: 'active' }) as unknown as FeatureState;

describe('buildCards', () => {
  const features = [
    f('1', 'baum', { stage: 'erfasst' }),
    f('2', 'baum', { stage: 'erfasst' }),
    f('3', 'baum', { stage: 'erledigt' }),
    f('4', 'flaeche', {}),
  ];

  it('one card per Objektart that has features, with its count, labelled in the locale', () => {
    const cards = buildCards(config, 'de', features);
    expect(cards.map((c) => [c.type, c.count])).toEqual(
      expect.arrayContaining([
        ['baum', 3],
        ['flaeche', 1],
      ]),
    );
    expect(cards.find((c) => c.type === 'massnahme')).toBeUndefined();
    expect(cards.find((c) => c.type === 'baum')?.label).toBe(
      (config.file.types?.baum?.label as Record<string, string>).de,
    );
  });

  it('a type with a process has one value row per stage, in declaration order, with counts', () => {
    const baum = buildCards(config, 'de', features).find((c) => c.type === 'baum');
    expect(baum?.values.map((v) => [v.value, v.count])).toEqual([
      ['erfasst', 2],
      ['kontrolliert', 0],
      ['massnahme', 0],
      ['erledigt', 1],
    ]);
    expect(baum?.values[0]?.label).toBe('Erfasst');
  });

  it('a type without a process has no value rows (no guessing a select property)', () => {
    const flaeche = buildCards(config, 'de', features).find((c) => c.type === 'flaeche');
    expect(flaeche?.values).toEqual([]);
  });

  it('an Objektart without a geometry property is not listed, as v3 (:322); the others carry a dot colour', () => {
    const lookup = f('7', 'baumart', {});
    const cards = buildCards(config, 'de', [lookup, ...features]);
    expect(cards.find((c) => c.type === 'baumart')).toBeUndefined();
    expect(cards.every((c) => c.color !== '' && c.values.every((v) => v.color !== ''))).toBe(true);
  });

  it('ignores deleted features', () => {
    const gone = { ...f('9', 'flaeche', {}), lifecycle: 'deleted' } as FeatureState;
    expect(buildCards(config, 'de', [gone])).toEqual([]);
  });
});

describe('deviceFilterData counts only the touched features (WP-800)', () => {
  const states = new Map<string, FeatureState>();
  const put = (id: string, stage: string): void => {
    states.set(id, { id, type: 'baum', properties: { stage }, lifecycle: 'active', updatedSeq: 1 } as never);
  };
  let reads = 0;
  const device = {
    config,
    classified: config,
    feature: (id: string) => states.get(id),
    viewList: () => ({
      rows: () => (reads++, [...states.values()].map((s) => ({ id: s.id }))),
      rowsOf: (ids: Iterable<string>) => [...ids].filter((i) => states.has(i)).map((id) => ({ id })),
    }),
  };
  it('matches a full recount after a burst of ids, without reading every row again', () => {
    for (let i = 0; i < 5; i++) put(`t${i}`, 'erfasst');
    let ring: (c: unknown) => void = () => undefined;
    const data = deviceFilterData(device as never, 'karte', 'de', {
      subscribe: (fn) => ((ring = fn as never), () => undefined),
    });
    let rang = 0;
    data.subscribe(() => rang++);
    data.cards();
    put('t0', 'kontrolliert');
    states.delete('t1');
    put('t9', 'erfasst');
    ring(new Set(['t0', 't1', 't9']));
    ring(new Set()); // moved nothing: no ring
    expect(rang).toBe(1);
    const incremental = data.cards();
    expect(reads).toBe(1);
    expect(incremental).toEqual(buildCards(config, 'de', states.values()));
  });
});

describe('buildCards: a child type at its parent (B-019)', () => {
  const types = {
    baum: {
      label: 'Baum',
      geometry: 'standort',
      properties: {},
      relations: { kontrollen: { inverse_of: 'kontrolle.baum', inherit_position: true } },
    },
    kontrolle: {
      label: 'Kontrolle',
      process: { property: 'status', start: 'offen', end: ['erledigt'] },
      properties: {
        status: {
          type: 'select',
          options: { offen: 'Offen', ueberfaellig: 'Überfällig', erledigt: 'Erledigt' },
        },
      },
    },
    notiz: { label: 'Notiz', properties: {} },
  };
  const cfg = { file: { types } } as unknown as CompiledConfig;
  it('is listed with its count and values although it has no geometry; a type with no place is not', () => {
    const cards = buildCards(cfg, 'de', [
      f('1', 'baum', {}),
      f('2', 'kontrolle', { status: 'offen' }),
      f('3', 'kontrolle', { status: 'ueberfaellig' }),
      f('4', 'notiz', {}),
    ]);
    expect(cards.map((c) => [c.type, c.count])).toEqual([
      ['baum', 1],
      ['kontrolle', 2],
    ]);
    expect(cards[1]?.values.map((v) => [v.value, v.count])).toEqual([
      ['offen', 1],
      ['ueberfaellig', 1],
      ['erledigt', 0],
    ]);
  });
});
