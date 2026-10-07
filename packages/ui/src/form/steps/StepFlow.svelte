<script lang="ts">
  // v3's multi-step task (detail module :166-180, :632-644, :1143-1148): the steps in the admin's order, "Schritt n von m"
  // above them when there are several, the values of every step collected, ONE submit at the end (one run per target
  // feature). A form step keeps its own pages; a quick-edit step edits the picked properties; a location step goes to the map.
  import { onDestroy } from 'svelte';
  import Button from '../../components/Button.svelte';
  import * as AlertDialog from '../../components/ui/alert-dialog';
  import type { RunProgress } from '../../task-sheet/contract';
  import { createRunSender, summarize } from '../../task-sheet/run-sender';
  import type { FormSession, Json, ToolSlot } from '../contract';
  import FormRenderer from '../FormRenderer.svelte';
  import type { StepFlowProps } from './contract';
  import LocationStep from './LocationStep.svelte';
  import { mergeStepValues } from './merge';

  const p: StepFlowProps = $props();
  type Values = Record<string, Json>;

  let phase: 'editing' | 'sent' = $state('editing');
  let index = $state(0);
  let perStep: (Values | undefined)[] = $state.raw([]);
  let picking = $state(false);
  let saveFailed = $state(false);
  // The task's own question, asked at the submit of the last step (WP-730); the one place of that timing.
  let asking = $state(false);
  let progress: Record<string, RunProgress> = $state({});
  let destroyed = false;
  // Steps where the map already opened by itself once: it opens when a location step is reached, never again unasked.
  const autoOpened = new Set<number>();

  const total = $derived(p.steps.length);
  const step = $derived(p.steps[index]);
  const last = $derived(index >= total - 1);
  // svelte-ignore state_referenced_locally: the task and the ports are fixed for the life of the flow
  const sub = createRunSender({
    taskKey: p.taskKey,
    ids: p.ids,
    submitter: p.submitter,
    featureIds: () => p.featureIds,
  });

  function keep(values: Values | undefined, at: number): void {
    const next = [...perStep];
    next[at] = values;
    perStep = next;
  }

  async function advance(values: Values): Promise<void> {
    keep(values, index);
    if (!last) {
      index += 1;
      return;
    }
    if (p.confirm) asking = true;
    else await submit();
  }

  async function submit(): Promise<void> {
    const result = await sub.submit(mergeStepValues(perStep));
    if (!result.stored && result.busy) return;
    if (!result.stored) {
      saveFailed = result.explained !== true;
      return;
    }
    saveFailed = false;
    if (destroyed) return;
    phase = 'sent';
    sub.watch((next) => (progress = { ...next }));
  }

  async function pick(): Promise<void> {
    const s = step;
    if (s?.kind !== 'location' || !p.pickLocation || picking) return;
    picking = true;
    try {
      const geometry = await p.pickLocation({
        property: s.property,
        label: s.label,
        current: perStep[index]?.[s.property] ?? s.current,
      });
      // always kept, even when it equals the stored shape: core writes nothing for an equal geometry, and a pin put
      // back on its original spot must replace an earlier move
      if (geometry !== undefined && !destroyed) keep({ [s.property]: geometry }, index);
    } finally {
      picking = false;
    }
  }

  // The map opens by itself when a location step is reached (v3: the task button went straight to the map).
  $effect(() => {
    const at = index;
    if (step?.kind !== 'location' || autoOpened.has(at) || perStep[at] !== undefined) return;
    autoOpened.add(at);
    void pick();
  });

  function back(): void {
    if (index === 0) p.onclose();
    else index -= 1;
  }

  function reopen(): void {
    sub.reset();
    progress = {};
    phase = 'editing';
  }

  const outcome = $derived(summarize(progress, sub.runIds()));
  const refusal = $derived(outcome.refusal);
  const allAccepted = $derived(outcome.accepted);
  const message = $derived(
    allAccepted ? p.labels.accepted : p.online ? p.labels.savedOnline : p.labels.savedOffline,
  );

  onDestroy(() => {
    destroyed = true;
    sub.dispose();
  });
</script>

{#snippet formTool(slot: ToolSlot)}
  {#if p.tool}{@render p.tool(slot)}{/if}
{/snippet}

{#snippet renderer(session: FormSession)}
  <FormRenderer
    {session}
    onsubmit={advance}
    oncancel={back}
    cancelLabel={index === 0 ? p.labels.cancel : p.labels.back}
    submitLabel={last ? p.labels.submit : p.labels.next}
    continues={!last}
    {...p.choices ? { choices: p.choices } : {}}
    {...p.tool ? { tool: formTool } : {}}
  />
{/snippet}

{#if asking && p.confirm}
  <AlertDialog.Root open={true} onOpenChange={(open) => !open && (asking = false)}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>{p.confirm.title}</AlertDialog.Title>
        <AlertDialog.Description>{p.confirm.text}</AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>{p.confirm.cancel}</AlertDialog.Cancel>
        <AlertDialog.Action
          onclick={() => {
            asking = false;
            void submit();
          }}
        >
          {p.confirm.go}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
{/if}

<div class="ub-step-flow flex min-h-full flex-col">
  {#if phase === 'editing' && step}
    {#if total > 1}
      <div class="px-4 py-2 text-center text-sm font-medium text-muted-foreground" data-testid="step-label">
        {p.labels.step(index + 1, total)}
      </div>
    {/if}
    {#if saveFailed}<p class="px-4 text-sm font-semibold text-destructive" role="alert">
        {p.labels.saveFailed}
      </p>{/if}
    {#key index}
      {#if step.kind === 'location'}
        <LocationStep
          label={step.label}
          chosen={perStep[index] !== undefined || step.current !== undefined}
          {picking}
          canPick={p.pickLocation !== undefined}
          {last}
          labels={p.labels}
          onpick={() => void pick()}
          onback={back}
          onnext={() => void advance(perStep[index] ?? {})}
        />
      {:else}
        {@render renderer(step.session)}
      {/if}
    {/key}
  {:else if phase === 'sent'}
    {#if refusal}
      <div class="flex flex-col gap-4 p-4" role="alert">
        <p class="m-0 font-semibold text-destructive">{p.labels.refused(refusal)}</p>
        <Button onclick={reopen}>{p.labels.reopen}</Button>
      </div>
    {:else}
      <div class="flex flex-col gap-4 p-4" role="status">
        <p class="m-0">{message}</p>
        <Button onclick={() => p.onclose()}>{p.labels.close}</Button>
      </div>
    {/if}
  {/if}
</div>
