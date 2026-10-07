<script lang="ts">
  // The Aktivität tab over a fixed feature history (a fake reader's entries), as the sheet draws it. Test fixture only.
  // `?empty=1` shows the empty state.
  import type { FeatureId, FeatureType, FoldedFeature, Instant, Key, RunId } from '@ueberblick/core/model';
  import { buildActivity, type ActivityEntry } from '@ueberblick/ui';
  import ActivityTab from '../ActivityTab.svelte';

  const type: FeatureType = {
    label: { de: 'Baum' },
    properties: {
      befund: { type: 'text', label: { de: 'Befund' } },
      hoehe: { type: 'number', label: { de: 'Höhe' } },
      stage: {
        type: 'select',
        label: { de: 'Status' },
        options: { erfasst: { de: 'Erfasst' }, massnahme: { de: 'Maßnahme' } },
      },
    },
    process: { property: 'stage' as Key, start: 'erfasst' as Key, end: ['massnahme' as Key] },
  };
  const NOW = '2026-10-01T12:00:00.000Z' as Instant;
  const at = (h: number): Instant => new Date(Date.parse(NOW) - h * 3_600_000).toISOString() as Instant;
  const run = (
    n: number,
    task: string,
    h: number,
    changes: [string, unknown][],
    who = 'Anna Beispiel',
  ): ActivityEntry => ({
    runId: `r${n}` as RunId,
    task,
    actorLabel: who,
    at: at(h),
    status: n === 4 ? 'pending' : 'accepted',
    changes: changes.map(([property, result]) => ({ property: property as Key, result: result as never })),
  });
  const activity: ActivityEntry[] = [
    run(4, 'Kontrolle', 0.1, [['befund', 'Neu']]),
    run(3, 'Maßnahme', 5, [['stage', 'massnahme']], 'Jemand'),
    run(
      2,
      'Kontrolle',
      50,
      [
        ['befund', 'Risse'],
        ['hoehe', 12],
      ],
      'Bert Muster',
    ),
    run(1, 'Erfassen', 100, [
      ['$type', 'baum'],
      ['stage', 'erfasst'],
      ['befund', 'Alt'],
    ]),
  ];
  const feature = {
    id: 't1' as FeatureId,
    type: 'baum' as Key,
    properties: {},
    lifecycle: 'active',
    updatedSeq: 1,
    derived: {},
  } as unknown as FoldedFeature;
  const empty = new URLSearchParams(location.search).has('empty');
  const view = buildActivity({
    feature,
    type,
    types: { baum: type },
    availableTasks: [],
    taskLabels: {},
    edgesOut: [],
    edgesIn: [],
    activity: empty ? [] : activity,
    lookups: { participant: () => undefined, feature: () => undefined },
    locale: 'de',
  });
</script>

<div class="mx-auto max-w-[450px] p-4"><ActivityTab {view} locale="de" now={NOW} /></div>
