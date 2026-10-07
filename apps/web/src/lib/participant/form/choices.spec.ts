// WP-725: the choices of a participant property follow v3's selectable-entities rule (`select.all` / `select.self`).
import { describe, expect, it } from 'vitest';
import { PropertySchema } from '@ueberblick/core';
import type { Key } from '@ueberblick/core/model';
import { choicesFor } from './choices';

type Prop = ReturnType<typeof PropertySchema.parse>;
const type = 'meldung' as Key;
const people = [
  { id: 'hanna', name: 'Hanna Holz' },
  { id: 'sven', name: 'Sven Sach' },
  { id: 'x1', name: '' },
  { id: 'x2', name: '' },
];

function device(roles: string[], zustaendig: Prop, choosable = people) {
  return {
    config: { file: { types: { [type]: { properties: { zustaendig } } } } },
    actor: { id: 'sven', roles },
    participant: { id: 'sven', name: 'Sven Sach' },
    store: { choosableParticipants: () => choosable, personName: () => undefined },
  } as unknown as Parameters<typeof choicesFor>[0];
}
const prop = (select?: object): Prop =>
  PropertySchema.parse({ type: 'participant', ...(select ? { select } : {}) });
const fields = [{ key: 'zustaendig' }];

describe('choicesFor a participant property', () => {
  it('a role in select.all gets the project participants by name; value is the id; unknown names are "Jemand", numbered', () => {
    const out = choicesFor(device(['sachbearbeiter'], prop({ all: ['sachbearbeiter'] })), type, fields, 'de');
    expect(out['zustaendig']).toEqual([
      { value: 'hanna', label: 'Hanna Holz' },
      { value: 'sven', label: 'Sven Sach' },
      { value: 'x1', label: 'Jemand 1' },
      { value: 'x2', label: 'Jemand 2' },
    ]);
  });

  it('a role in select.self, or no select at all, may choose only oneself, by name', () => {
    const only = [{ value: 'sven', label: 'Sven Sach' }];
    expect(
      choicesFor(device(['handwerker'], prop({ self: ['handwerker'] })), type, fields, 'de')['zustaendig'],
    ).toEqual(only);
    expect(choicesFor(device(['handwerker'], prop()), type, fields, 'de')['zustaendig']).toEqual(only);
  });

  it('a role in neither list gets no choices (v3 default deny)', () => {
    expect(
      choicesFor(device(['melder'], prop({ all: ['sachbearbeiter'] })), type, fields, 'de')['zustaendig'],
    ).toEqual([]);
  });
});

describe('choicesFor a role property (WP-481)', () => {
  const roles = { a: { label: { de: 'Eins' } }, b: { label: { de: 'Zwei' } } };
  const dev = (held: string[], select?: object) => {
    const zustaendig = PropertySchema.parse({ type: 'role', ...(select ? { select } : {}) });
    return {
      config: { file: { roles, types: { [type]: { properties: { zustaendig } } } } },
      actor: { id: 'sven', roles: held },
    } as unknown as Parameters<typeof choicesFor>[0];
  };
  const values = (d: ReturnType<typeof dev>) =>
    choicesFor(d, type, fields, 'de')['zustaendig']?.map((c) => c.value);
  it('offers every role without select, any with select.all, held ones with select.self, none otherwise', () => {
    expect(values(dev(['x']))).toEqual(['a', 'b']);
    expect(values(dev(['x'], { all: ['x'] }))).toEqual(['a', 'b']);
    expect(values(dev(['a'], { self: ['a'] }))).toEqual(['a']);
    expect(values(dev(['x'], { self: ['a'] }))).toEqual([]);
  });
});

describe('choicesFor a reference property (Mehrfachauswahl, Anzeigefeld; A-048)', () => {
  const art = PropertySchema.parse({
    type: 'reference',
    to: 'baumart',
    cardinality: 'many',
    display_property: 'lat',
  });
  const target = { id: 'a1', type: 'baumart', properties: { name: 'Linde', lat: 'Tilia' } };
  const refDevice = {
    config: { file: { types: { [type]: { properties: { arten: art } } } } },
    store: { featureIdsOfType: () => ['a1'] },
    feature: () => target,
    reader: {
      labelOf: (_s: unknown, _l: string, via?: { display_property?: string }) =>
        target.properties[(via?.display_property ?? 'name') as 'name' | 'lat'],
    },
  } as unknown as Parameters<typeof choicesFor>[0];

  it('labels each target by the chosen column of the property', () => {
    expect(choicesFor(refDevice, type, [{ key: 'arten' }], 'de')['arten']).toEqual([
      { value: 'a1', label: 'Tilia' },
    ]);
  });
});
