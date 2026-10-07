<script lang="ts">
  // A page that runs a form + location task through StepFlow, as the participant's task sheet does. Test fixture only:
  // the run queue is a list on the page, the map is a panel with v3's "Standort bestätigen" pill.
  import type { FeatureId, Key } from '@ueberblick/core/model';
  import type { RunDraft, RunSubmitter } from '../../../task-sheet/contract';
  import type { Json } from '../../contract';
  import { buildFormModel } from '../../model';
  import type { LocationRequest, StepLabels, StepView } from '../contract';
  import StepFlow from '../StepFlow.svelte';
  import { fakeSession } from './fake-session';

  const task = 'pflege' as Key;
  const form = buildFormModel({
    form: { befund: { required: true } },
    properties: { befund: { type: 'text', label: 'Befund' } } as never,
  });
  const steps: StepView[] = [
    { kind: 'form', session: fakeSession(form, ['befund']) },
    { kind: 'location', property: 'lage' as Key, label: 'Lage' },
  ];

  const labels: StepLabels = {
    step: (c, t) => `Schritt ${c} von ${t}`,
    back: 'Zurück',
    cancel: 'Abbrechen',
    next: 'Weiter',
    submit: 'Absenden',
    locationUnset: 'Noch kein Standort gewählt',
    locationSet: 'Standort gewählt',
    locationPick: 'Standort auf der Karte wählen',
    locationUnavailable: 'Die Karte ist hier nicht verfügbar.',
    savedOnline: 'Gespeichert. Wird jetzt gesendet.',
    savedOffline: 'Gespeichert. Wird gesendet, sobald Sie online sind.',
    saveFailed: 'Nicht gespeichert.',
    accepted: 'Angenommen.',
    refused: (r) => `Abgelehnt: ${r}`,
    reopen: 'Erneut bearbeiten',
    close: 'Schließen',
  };

  let runs = $state<RunDraft[]>([]);
  let closed = $state(false);
  let map = $state<{ resolve: (g: Json | undefined) => void; request: LocationRequest } | undefined>();
  let n = 0;
  const submitter: RunSubmitter = {
    submit: async (run) => {
      runs = [...runs, run];
      return 'queued';
    },
    outcome: () => () => undefined,
  };
  const pickLocation = (request: LocationRequest) =>
    new Promise<Json | undefined>((resolve) => (map = { resolve, request }));
  const settle = (g: Json | undefined) => {
    map?.resolve(g);
    map = undefined;
  };
</script>

<div class="mx-auto max-w-md">
  <StepFlow
    taskKey={task}
    {steps}
    {labels}
    ids={{ runId: () => `018f0000-0000-7000-8000-${String(++n).padStart(12, '0')}` as never }}
    {submitter}
    featureIds={['f1' as FeatureId]}
    online={true}
    {pickLocation}
    onclose={() => (closed = true)}
  />
</div>

{#if map}
  <div class="fixed inset-0 z-50 bg-muted" role="dialog" aria-label="Karte">
    <p class="p-4 text-sm">Karte: {map.request.label}</p>
    <div
      class="fixed bottom-20 left-1/2 z-[1100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-destructive px-5 py-3 text-white shadow-lg lg:bottom-8"
    >
      <button
        type="button"
        class="font-semibold"
        onclick={() => settle({ type: 'Point', coordinates: [7.1, 50.7] })}
      >
        Standort bestätigen
      </button>
      <button
        type="button"
        class="text-2xl leading-none font-bold"
        aria-label="Abbrechen"
        onclick={() => settle(undefined)}
      >
        &times;
      </button>
    </div>
  </div>
{/if}

<pre data-testid="runs">{JSON.stringify(
    runs.map((r) => ({ task: r.task, featureId: r.featureId, input: r.input })),
  )}</pre>
<p data-testid="closed">{closed ? 'closed' : 'open'}</p>
