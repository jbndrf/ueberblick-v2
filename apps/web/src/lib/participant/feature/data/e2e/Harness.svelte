<script lang="ts">
  // A page that draws the Daten tab from a model built by the real builder. Test fixture only.
  import type { FeatureId, FeatureType, FoldedFeature, Key } from '@ueberblick/core/model';
  import { buildFeatureSheetModel, type ActivityEntry } from '@ueberblick/ui';
  import DataTab from '../../DataTab.svelte';
  import { buildDataLayout } from '../layout';

  // `?tabs=1`: the admin's layout (WP-659): "Kontrolle" first by tab_order, a hidden and a conditional property, Messungen.
  const tabbed = new URLSearchParams(location.search).has('tabs');
  const display = (key: string): FeatureType['properties'][string]['display'] =>
    !tabbed
      ? undefined
      : (
          {
            name: { history: 'measurements' },
            notiz: { tab: 'Kontrolle', tab_order: -1, row: 1, column: 'right' },
            arten: { tab: 'Kontrolle', tab_order: -1, row: 1, column: 'left' },
            gepflanzt: { tab: 'Pflanzung', tab_order: 5 },
            leer: { hidden: true },
            foto: { tab: 'Fotos', tab_order: 9, condition: 'self.name == "x"' },
          } as const
        )[key as 'name'];
  const withDisplay = (p: FeatureType['properties']): FeatureType['properties'] =>
    Object.fromEntries(
      Object.entries(p).map(([k, v]) => [k, display(k) === undefined ? v : { ...v, display: display(k) }]),
    );
  const base: FeatureType = {
    label: 'Baum',
    geometry: 'lage',
    properties: {
      name: { type: 'text', label: 'Name' },
      notiz: { type: 'text', label: 'Notiz' },
      leer: { type: 'text', label: 'Leer' },
      arten: { type: 'multiselect', label: 'Arten', options: { a: 'Eiche', b: 'Buche', c: 'Ahorn' } },
      gepflanzt: { type: 'date', label: 'Gepflanzt' },
      foto: { type: 'file', label: 'Foto' },
    },
  };
  const type: FeatureType = { ...base, properties: withDisplay(base.properties) };
  const feature = {
    id: 't1' as FeatureId,
    type: 'baum' as Key,
    deleted: false,
    updatedSeq: 1,
    properties: {
      name: 'Alte Eiche',
      notiz: 'Zeile eins\nZeile zwei',
      arten: ['c', 'a'],
      gepflanzt: '2024-03-05',
    },
    derived: {},
  } as unknown as FoldedFeature;
  const run = (n: number, result: string | null): ActivityEntry => ({
    runId: `r${n}` as ActivityEntry['runId'],
    task: 'Kontrolle',
    actorLabel: 'Anna',
    at: `2026-01-0${n}T10:00:00.000Z` as ActivityEntry['at'],
    status: 'synced' as ActivityEntry['status'],
    changes: [{ property: 'name' as Key, result }],
  });
  const sheet = buildFeatureSheetModel({
    feature,
    type,
    types: { baum: type },
    availableTasks: [],
    taskLabels: {},
    edgesOut: [],
    edgesIn: [],
    activity: [run(3, null), run(2, 'Eiche'), run(1, 'Alte Eiche')],
    lookups: { participant: () => undefined, feature: () => undefined },
    locale: 'de',
  });
  // the condition on `foto` is false for this feature (name is not "x")
  const model = {
    ...sheet,
    layout: buildDataLayout({
      type,
      rows: sheet.rows,
      conditionFalse: new Set<Key>(tabbed ? ['foto' as Key] : []),
      locale: 'de',
    }),
  };
</script>

<div class="mx-auto max-w-md p-4">
  <DataTab {model} locale="de" onopen={() => {}} />
</div>
