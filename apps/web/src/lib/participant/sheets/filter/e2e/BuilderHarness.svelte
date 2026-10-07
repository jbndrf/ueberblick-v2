<script lang="ts">
  // The Ansichten tab with a saved, active view and the real builder over a small project, plus what "the map" would
  // show: the ids that pass the view, evaluated by core's `applyFilter` (the harness has no map). Test fixture only.
  import { applyFilter, compileFilter, type FilterSource } from '@ueberblick/core/filters';
  import type { EvalContext } from '@ueberblick/core/expr';
  import type { FeatureState, Key } from '@ueberblick/core/model';
  import { compile } from '@ueberblick/core/compile';
  import { actorValue, compilePerms } from '@ueberblick/core/perms';
  import { readSystemField } from '@ueberblick/core/registry';
  import { TemplateFileSchema } from '@ueberblick/core/schema';
  import FilterSheet from '../FilterSheet.svelte';
  import ViewBuilder from '../builder/ViewBuilder.svelte';
  import { builderPort } from '../builder/port';
  import { createFilterController } from '../filter-controller';
  import { memoryPrefs } from '../filter-state';

  const parsed = TemplateFileSchema.parse({
    schema: 'ueberblick/1',
    template: { key: 'harness', version: '1.0.0' },
    roles: { kontrolle: { label: { de: 'Kontrolle' } } },
    types: {
      baum: {
        label: { de: 'Baum' },
        permissions: { see: '$all', create: '$all', write: '$all' },
        process: { property: 'stage', start: 'erfasst', end: ['erledigt'] },
        geometry: 'standort',
        properties: {
          standort: { type: 'geometry', geometry_type: 'point' },
          stage: {
            type: 'select',
            label: { de: 'Status' },
            options: { erfasst: { de: 'Erfasst' }, erledigt: { de: 'Erledigt' } },
          },
          befund: { type: 'text', label: { de: 'Befund' } },
          hoehe_m: { type: 'number', label: { de: 'Höhe (m)' } },
          faellig_am: { type: 'date', label: { de: 'Fällig am' } },
          vitalitaet: {
            type: 'select',
            label: { de: 'Vitalität' },
            options: { v1: { de: '1' }, v2: { de: '2' }, v3: { de: '3' } },
          },
        },
      },
    },
  });
  const compiled = compile(parsed, { assets: () => undefined });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
  const config = compiled.config;
  const actor = { id: 'u1', kind: 'participant' as const, roles: ['kontrolle' as Key] };

  const tree = (
    id: string,
    by: string,
    properties: Record<string, unknown>,
    createdAt: string,
  ): FeatureState =>
    ({
      id,
      type: 'baum',
      properties,
      lifecycle: 'active',
      updatedSeq: 1,
      createdBy: by,
      createdAt,
      changedAt: createdAt,
    }) as unknown as FeatureState;
  const trees = [
    tree(
      't1',
      'u1',
      { befund: 'Pilzbefall', hoehe_m: 4, stage: 'erfasst', vitalitaet: 'v3' },
      '2026-09-01T08:00:00.000Z',
    ),
    tree(
      't2',
      'u2',
      { befund: 'gesund', hoehe_m: 12, stage: 'erledigt', vitalitaet: 'v1' },
      '2026-09-20T08:00:00.000Z',
    ),
    tree(
      't3',
      'u2',
      { befund: 'Pilz am Stamm', hoehe_m: 20, stage: 'erfasst', vitalitaet: 'v2' },
      '2026-10-05T08:00:00.000Z',
    ),
    tree(
      't4',
      'u3',
      { befund: 'trocken', hoehe_m: 7, stage: 'erfasst', vitalitaet: 'v2' },
      '2026-10-08T08:00:00.000Z',
    ),
  ];

  const port = builderPort({
    config,
    actor,
    locale: 'de',
    features: () => trees,
    nameOf: (id) => ({ u1: 'Berta', u2: 'Anton' })[id],
    unknown: 'Jemand',
  });

  const byId = new Map(trees.map((t) => [t.id as string, t]));
  const ctx: EvalContext = {
    vars: new Map([['actor', actorValue(actor)]]),
    features: {
      property: (id, key) => {
        const f = byId.get(id);
        return f === undefined
          ? undefined
          : key.startsWith('$')
            ? readSystemField(f, key)
            : f.properties[key];
      },
      related: () => [],
      history: () => [],
      type: (id) => byId.get(id)?.type,
    },
    now: '2026-10-10T08:00:00.000Z',
    relations: new Map(),
    geo: {} as never,
  };
  const env = { config, perms: compilePerms(config), actor, ctx };

  let filters = $state<FilterSource>({});
  const shown = $derived.by(() => {
    const c = compileFilter(config, filters);
    return c.ok ? applyFilter(env, c.filter, 'baum', trees).map((f) => f.id) : ['compile-error'];
  });

  const controller = createFilterController(memoryPrefs());
  controller.setActiveView({ kind: 'saved', key: 'v1' });
  let open = $state(true);
</script>

<pre data-testid="shown">{shown.join(',')}</pre>
<pre data-testid="source">{JSON.stringify(filters)}</pre>
<FilterSheet
  bind:open
  data={{ cards: () => [], subscribe: () => () => undefined }}
  {controller}
  locale="de"
  initialTab="views"
  views={{
    presets: [],
    saved: [{ id: 'v1', name: 'Meine Ansicht' }],
    save: () => undefined,
    rename: () => undefined,
    remove: () => undefined,
  }}
>
  {#snippet builder()}
    <ViewBuilder {port} {filters} locale="de" onsave={(f) => (filters = f)} />
  {/snippet}
</FilterSheet>
