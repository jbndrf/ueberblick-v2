<script lang="ts">
  // The task form as the participant sees it: the real shell (35/90 vh, 450 px panel) over the real flow and form
  // renderer, a stand-in session (the rules are core.form's). Test fixture only. `?short=1` is a one-field form,
  // `?slow=1` a submit that takes a while (the "Wird gesendet…" state).
  import type { FeatureId, Key } from '@ueberblick/core/model';
  import ModuleShell from '../../components/module-shell/ModuleShell.svelte';
  import type { RunDraft, RunSubmitter } from '../../task-sheet/contract';
  import { buildFormModel } from '../model';
  import type { StepLabels, StepView } from '../steps/contract';
  import { fakeSession } from '../steps/e2e/fake-session';
  import StepFlow from '../steps/StepFlow.svelte';

  const query = new URLSearchParams(location.search);
  const short = query.has('short');
  const slow = query.has('slow');
  const task = 'pflege' as Key;
  const properties = {
    art: { type: 'text', label: 'Art' },
    mail: { type: 'text', label: 'E-Mail' },
    hoehe: { type: 'number', label: 'Höhe' },
    breite: { type: 'number', label: 'Breite' },
    notiz: { type: 'text', label: 'Notiz' },
  };
  const form = short
    ? { art: { required: true } }
    : {
        art: { required: true, placeholder: { de: 'z. B. Linde' } },
        mail: { appearance: 'email' },
        hoehe: { row: 1, column: 'left' as const },
        breite: { row: 1, column: 'right' as const },
        notiz: { page: { label: { de: 'Befund' }, hint: { de: 'Bitte beschreiben.' } } },
      };
  const model = buildFormModel({ form, properties: properties as never });
  const steps: StepView[] = [{ kind: 'form', session: fakeSession(model, ['art']) }];

  const labels: StepLabels = {
    step: (c, t) => `Schritt ${c} von ${t}`,
    back: 'Zurück',
    cancel: 'Abbrechen',
    next: 'Weiter',
    submit: 'Absenden',
    locationUnset: '',
    locationSet: '',
    locationPick: '',
    locationUnavailable: '',
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
  let expanded = $state(true);
  let n = 0;
  const submitter: RunSubmitter = {
    submit: async (run) => {
      if (slow) await new Promise((r) => setTimeout(r, 1200));
      runs = [...runs, run];
      return 'queued';
    },
    outcome: () => () => undefined,
  };
</script>

<div class="fixed inset-0 bg-muted">
  <p class="p-4 text-sm">Karte</p>
</div>
<ModuleShell
  open={!closed}
  bind:expanded
  title="Baum"
  label="Pflege"
  toggleLabel="Größe ändern"
  closeLabel="Schließen"
  onclose={() => (closed = true)}
  testid="form-shell"
>
  <StepFlow
    taskKey={task}
    {steps}
    {labels}
    ids={{ runId: () => `018f0000-0000-7000-8000-${String(++n).padStart(12, '0')}` as never }}
    {submitter}
    featureIds={['f1' as FeatureId]}
    online={true}
    onclose={() => (closed = true)}
  />
</ModuleShell>

<pre class="sr-only" data-testid="runs">{JSON.stringify(
    runs.map((r) => ({ task: r.task, input: r.input })),
  )}</pre>
<p class="sr-only" data-testid="closed">{closed ? 'closed' : 'open'}</p>
