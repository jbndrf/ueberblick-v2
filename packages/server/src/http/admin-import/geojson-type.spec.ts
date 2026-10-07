// WP-390: a FeatureCollection becomes a new type of the draft (core's `importedType`), the draft compiles, and the
// features go in as runs of its creating task through WP-363's import (R3).
import { describe, expect, it } from 'vitest';
import {
  geometryKeyOf,
  importedType,
  stringifyForText,
  surveyFeatureCollection,
  type FeatureCollectionLike,
  type ImportColumnType,
  type Key,
  type TemplateFile,
} from '@ueberblick/core';
import { importFile } from '../../io';
import { importer } from '../../io/testkit';
import { build, golden, setup } from '../../store/run/testkit';

const FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.1, 50.1] },
      properties: { Art: 'Eiche', 'Höhe (m)': 12.5, gepflanzt: '2020-05-01', geschuetzt: true },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.2, 50.2] },
      properties: { Art: 'Linde', 'Höhe (m)': 8, gepflanzt: '2019-03-15', geschuetzt: false },
    },
    { type: 'Feature', geometry: null, properties: { Art: 'Ohne Standort' } },
  ],
};

/** The golden project's file with the imported type and its task added, as the draft's overlay does. */
function withImportedType(columns: Record<string, ImportColumnType>) {
  const parsed = surveyFeatureCollection(FC);
  if (!parsed.ok) throw new Error('survey');
  const survey = parsed.survey;
  const base = golden('musterstadt-baeume').file;
  const made = importedType(
    {
      name: 'Hochstämme',
      geometry: geometryKeyOf(survey.geometryKinds),
      columns: survey.columns.map((c) => ({ name: c.name, type: columns[c.name] ?? c.inferred })),
    },
    'hochstaemme',
    Object.keys(base.tasks ?? {}),
  );
  const file: TemplateFile = {
    ...base,
    types: { ...base.types, hochstaemme: made.type },
    tasks: { ...base.tasks, [made.taskKey]: made.task },
  } as unknown as TemplateFile;
  const mapping = { ...made.mapping, task: made.mapping.task as Key };
  return { made, mapping, collection: parsed.collection, config: build(file) };
}

const deps = (ctx: ReturnType<typeof setup>) => ({
  config: ctx.config,
  configVersion: 1,
  actor: importer,
  ids: ctx.deps.ids,
  geo: ctx.deps.geo,
});

const stored = (ctx: ReturnType<typeof setup>) =>
  ctx.db
    .prepare<{ properties: string }>(
      "SELECT properties FROM features WHERE type = 'hochstaemme' ORDER BY rowid",
    )
    .all()
    .map((r) => JSON.parse(r.properties) as Record<string, unknown>);

describe('a GeoJSON file as a new type', () => {
  it('the inferred properties and the geometry property compile; every feature is imported as a run', () => {
    const { mapping, collection, config } = withImportedType({});
    const ctx = setup({ config });
    const data = JSON.stringify(collection);
    const r = importFile(ctx.store, { format: 'geojson', data }, mapping, deps(ctx));
    expect(r).toMatchObject({ outcome: 'accepted', imported: 3 });
    const rows = stored(ctx);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      art: 'Eiche',
      hoehe_m: 12.5,
      gepflanzt: '2020-05-01',
      geschuetzt: true,
      geometrie: { type: 'Point', coordinates: [7.1, 50.1] },
    });
    // a feature without geometry keeps its values, as in v3
    expect(rows[2]).toMatchObject({ art: 'Ohne Standort' });
    const runs = ctx.db
      .prepare<{ n: number }>("SELECT count(*) AS n FROM runs WHERE task = 'hochstaemme_import'")
      .get();
    expect(runs?.n).toBe(3);
  });

  it('the type has no permissions: no participant can create it, the task is offered nowhere', () => {
    const { made, config } = withImportedType({});
    expect(made.task['on']).toBe('$none');
    expect(config.file.types?.['hochstaemme']?.permissions).toBeUndefined();
  });

  it('an override (a boolean column as text) needs the text conversion; with it the rows import', () => {
    const { mapping, collection, config } = withImportedType({ geschuetzt: 'text' });
    const ctx = setup({ config });
    const raw = importFile(
      ctx.store,
      { format: 'geojson', data: JSON.stringify(collection) },
      mapping,
      deps(ctx),
    );
    expect(raw).toMatchObject({ outcome: 'refused' });

    const ctx2 = setup({ config });
    const fixed = stringifyForText(collection as FeatureCollectionLike, { geschuetzt: 'text' });
    const ok = importFile(
      ctx2.store,
      { format: 'geojson', data: JSON.stringify(fixed) },
      mapping,
      deps(ctx2),
    );
    expect(ok).toMatchObject({ outcome: 'accepted', imported: 3 });
    expect(stored(ctx2)[0]).toMatchObject({ geschuetzt: 'true' });
  });
});
