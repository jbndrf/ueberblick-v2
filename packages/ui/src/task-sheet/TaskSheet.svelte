<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '../components/ui/button';
  import { TARGET_SIZE } from '../tokens';
  import { m } from '../paraglide/messages.js';
  import type { FormSession, Json, ToolSlot } from '../form/contract';
  import { createFormSession } from '../form/session';
  import FormRenderer from '../form/FormRenderer.svelte';
  import { DRAFT_SAVE_DELAY_MS, type RunProgress, type TaskSheetProps, type TimerPort } from './contract';
  import { createRunSender, summarize } from './run-sender';

  const p: TaskSheetProps = $props();

  type Values = Record<string, Json>;
  type Phase = 'loading' | 'editing' | 'sent';

  let phase: Phase = $state('loading');
  let session: FormSession | null = $state.raw(null);
  let restored = $state(false);
  let saveFailed = $state(false);
  let generation = $state(0);
  let progress: Record<string, RunProgress> = $state({});

  let latest: Values | undefined;
  // JSON of the values last written to the draft store (or the opening values): no write when equal.
  let saved = '';
  let pendingSave: unknown;
  // svelte-ignore state_referenced_locally: the timer port is fixed for the life of the sheet
  const timer: TimerPort = p.timer ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let submitted: Values = {};
  let destroyed = false;
  // svelte-ignore state_referenced_locally: the task and the ports are fixed for the life of the sheet
  const sub = createRunSender({
    taskKey: p.taskKey,
    ids: p.ids,
    submitter: p.submitter,
    featureIds: () => p.featureIds,
  });
  const key = (): string => p.draftKey ?? [p.taskKey, ...(p.featureIds ?? [])].join(':');

  async function load(): Promise<void> {
    const stored = await p.drafts.get(key());
    if (destroyed) return;
    restored = stored !== undefined;
    const s = createFormSession(p.model, {
      task: p.taskKey,
      config: p.config,
      ctx: p.ctx,
      ...(p.type ? { type: p.type } : {}),
      ...(p.locale ? { locale: p.locale } : {}),
      initial: stored ?? p.initial ?? {},
    });
    saved = JSON.stringify(s.draft());
    latest = undefined;
    sub.reset();
    saveFailed = false;
    session = s;
    generation += 1;
    phase = 'editing';
  }
  void load();

  // A runtime language switch re-labels the open form; the values and the draft stay (WP-790).
  $effect(() => {
    if (p.locale) session?.setLocale(p.locale);
  });

  function keepDraft(): void {
    timer.clear(pendingSave);
    pendingSave = undefined;
    if (phase !== 'editing' || !latest || JSON.stringify(latest) === saved) return;
    const snapshot = JSON.stringify(latest);
    saved = snapshot;
    // a draft that cannot be kept (storage full) is shown, not swallowed; the next change tries again
    p.drafts.put(key(), latest).then(
      () => void (saveFailed = false),
      () => {
        if (saved === snapshot) saved = '';
        saveFailed = true;
      },
    );
  }

  function changed(v: Values): void {
    latest = v;
    timer.clear(pendingSave);
    pendingSave = timer.set(keepDraft, DRAFT_SAVE_DELAY_MS);
  }

  async function submit(values: Values): Promise<void> {
    const result = await sub.submit(values);
    if (!result.stored && result.busy) return;
    if (!result.stored) {
      saveFailed = result.explained !== true;
      return;
    }
    saveFailed = false;
    submitted = values;
    latest = undefined;
    timer.clear(pendingSave);
    pendingSave = undefined;
    // A failing drop must not hide a run that is already stored: the draft is stale, not the run.
    await p.drafts.drop(key()).catch(() => undefined);
    if (destroyed) return;
    phase = 'sent';
    sub.watch((next) => (progress = { ...next }));
  }

  async function reopen(): Promise<void> {
    sub.reset();
    progress = {};
    await p.drafts.put(key(), submitted);
    await load();
  }

  // Aggregate over all runs: refused wins, done only when every run is accepted.
  const outcome = $derived(summarize(progress, sub.runIds()));
  const refusal = $derived(outcome.refusal === undefined ? undefined : { reason: outcome.refusal });
  const allAccepted = $derived(outcome.accepted);
  const refusedText = $derived(refusal ? m.task_sheet_refused({ reason: refusal.reason }) : '');
  const message = $derived(
    allAccepted
      ? m.task_sheet_accepted()
      : p.online
        ? m.task_sheet_saved_online()
        : m.task_sheet_saved_offline(),
  );

  function onvisibility(): void {
    if (document.visibilityState === 'hidden') keepDraft();
  }
  $effect(() => {
    document.addEventListener('visibilitychange', onvisibility);
    return () => document.removeEventListener('visibilitychange', onvisibility);
  });
  onDestroy(() => {
    destroyed = true;
    keepDraft();
    sub.dispose();
  });
</script>

{#snippet formTool(slot: ToolSlot)}
  {#if p.tool}
    {@render p.tool({ field: slot.field, value: slot.value, id: slot.id, produce: slot.set })}
  {/if}
{/snippet}

<div class="ub-task-sheet">
  {#if phase === 'editing' && session}
    {#if restored}<p class="note">{m.task_sheet_restored()}</p>{/if}
    {#if saveFailed}<p class="fail" role="alert">{m.task_sheet_save_failed()}</p>{/if}
    {#key generation}
      <FormRenderer
        {session}
        onsubmit={submit}
        ondraft={changed}
        {...p.onclose ? { oncancel: p.onclose } : {}}
        {...p.choices ? { choices: p.choices } : {}}
        {...p.tool ? { tool: formTool } : {}}
      />
    {/key}
  {:else if phase === 'sent'}
    {#if refusal}
      <div class="outcome refused" role="alert">
        <p>{refusedText}</p>
        <Button class="w-full" style={`min-height:${TARGET_SIZE.primary}px`} onclick={reopen}>
          {m.task_sheet_reopen()}
        </Button>
      </div>
    {:else}
      <div class="outcome" role="status">
        <p>{message}</p>
        <Button
          variant="outline"
          class="w-full"
          style={`min-height:${TARGET_SIZE.primary}px`}
          onclick={() => p.onclose?.()}
        >
          {m.ui_close()}
        </Button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .ub-task-sheet {
    display: flex;
    flex-direction: column;
    gap: var(--ub-space-md);
    /* fills the shell's scroll area, so the form's footer sits at the bottom edge of a short form too (v3) */
    min-height: 100%;
  }
  .note {
    margin: 0;
    color: var(--ub-color-text-muted);
    font-size: var(--ub-type-size-sm);
  }
  .fail,
  .refused p {
    margin: 0;
    color: var(--ub-color-danger);
    font-weight: var(--ub-type-weight-bold, 600);
  }
  /* the same side padding as the form's footer (`p-4`), so the text never sits flush at the edge */
  .outcome {
    display: flex;
    flex-direction: column;
    gap: var(--ub-space-md);
    padding: var(--ub-space-md);
  }
  .outcome p {
    margin: 0;
  }
</style>
