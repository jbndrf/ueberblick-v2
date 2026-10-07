<script lang="ts">
  // v3's task form (reference FormFillTool.svelte, form-renderer/FormRenderer.svelte): page tabs with the missing
  // count, "Weiter" that never blocks, "Absenden" that validates every page and jumps to the first page with an error,
  // and the clearing guard. Validation, relevance and required come from the session (core.form, R1).
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Send from '@lucide/svelte/icons/send';
  import { Button } from '../components/ui/button';
  import ErrorSummary from '../components/ErrorSummary.svelte';
  import { m } from '../paraglide/messages.js';
  import { TARGET_SIZE } from '../tokens';
  import ClearingDialog from './ClearingDialog.svelte';
  import type { ClearedField, FieldIssue, FormField, FormRendererProps, Json } from './contract';
  import FieldInput from './FieldInput.svelte';
  import { COLUMN_CLASS, formLines } from './layout';
  import { localize } from './localize';
  import PageTabs from './PageTabs.svelte';

  let {
    session,
    onsubmit,
    oncancel,
    cancelLabel,
    submitLabel,
    continues = false,
    ondraft,
    choices,
    tool,
    readonly: view = false,
  }: FormRendererProps = $props();

  let tick = $state(0);
  let page = $state(0);
  // Set after the first Absenden: from then on the issues follow each edit and the tabs count what is missing.
  let attempted = $state(0);
  let pending: readonly ClearedField[] | undefined = $state.raw(undefined);
  // True while the caller's `onsubmit` runs (v3 `isSubmitting`): the buttons are disabled and the Absenden button says so.
  let submitting = $state(false);

  $effect(() =>
    session.subscribe(() => {
      tick += 1;
      ondraft?.(session.draft());
    }),
  );

  // The session's locale can switch while the form is open (it notifies like an edit, so `tick` re-reads it).
  const locale = $derived.by(() => {
    void tick;
    return session.locale;
  });
  const pageCount = $derived(session.model.pages.length);
  const last = $derived(page >= pageCount - 1);
  const hasFields = $derived(session.model.fields.length > 0);
  // One row per relevant field, re-read on every change (the session is not reactive by itself).
  const rows = $derived.by(() => {
    void tick;
    return session.visibleFields(page).map((f) => ({
      f,
      row: f.row,
      column: f.column ?? 'full',
      value: session.get(f.key),
      required: !view && session.isRequired(f.key),
      readonly: session.isReadonly(f.key),
      offered: session.offered(f.key),
      waiting: session.waitingForSource(f.key),
    }));
  });
  // The rows grouped into lines as v3 `groupFieldsByLayout`: a left and a right cell of one row share a line.
  const lines = $derived(formLines(rows));
  const byPage = $derived.by((): FieldIssue[][] => {
    void tick;
    return attempted > 0 ? session.model.pages.map((_, i) => session.validatePage(i)) : [];
  });
  const issues = $derived(byPage[page] ?? []);
  const pageTitle = (i: number): string | undefined => {
    const t = session.model.pageInfo[i]?.title;
    return t === undefined ? undefined : localize(t, locale) || undefined;
  };
  const pageHint = $derived.by(() => {
    const d = session.model.pageInfo[page]?.description;
    return d === undefined ? undefined : localize(d, locale) || undefined;
  });
  const heading = $derived(pageTitle(page));
  const tabs = $derived(
    session.model.pages.map((_, i) => ({
      title: pageTitle(i) ?? m.form_page_title({ page: i + 1 }),
      missing: byPage[i]?.length ?? 0,
    })),
  );

  function message(i: FieldIssue): string {
    const f = session.model.fields.find((x) => x.key === i.fieldKey);
    const l = f ? localize(f.label, locale) : i.fieldKey;
    if (i.message) return i.message;
    if (i.kind === 'required') return m.form_error_required({ label: l });
    if (i.fault === 'min') return m.form_error_min({ label: l, min: f?.min ?? 0 });
    if (i.fault === 'max') return m.form_error_max({ label: l, max: f?.max ?? 0 });
    if (i.fault === 'integer') return m.form_error_integer({ label: l });
    return m.form_error_constraint({ label: l });
  }
  const summary = $derived(issues.map((i) => ({ fieldId: i.fieldId, message: message(i) })));
  const errorOf = (f: FormField) => {
    const i = issues.find((x) => x.fieldKey === f.key);
    return i ? message(i) : undefined;
  };

  async function send(values: Record<string, Json>): Promise<void> {
    if (submitting) return;
    submitting = true;
    try {
      await onsubmit(values);
    } finally {
      submitting = false;
    }
  }

  function submit() {
    const all = session.model.pages.map((_, i) => session.validatePage(i));
    const first = all.findIndex((p) => p.length > 0);
    if (first >= 0) {
      attempted += 1;
      page = first;
      return;
    }
    const clearing = session.clearing();
    if (clearing.length > 0) pending = clearing;
    else void send(session.submitValues());
  }
  function confirmClear() {
    pending = undefined;
    void send(session.submitValuesCleared());
  }
  function onform(e: Event) {
    e.preventDefault();
    if (view || submitting) return;
    if (last) submit();
    else page += 1;
  }
</script>

<form class="flex min-h-full flex-1 flex-col" novalidate onsubmit={onform}>
  <!-- The kit's message calls are not reactive (`setUiLocale`): a language switch remounts the form body, the values live in the session (WP-828). -->
  {#key locale}
    <div class="flex-1 space-y-4 p-4">
      {#if pageCount > 1}
        <PageTabs pages={tabs} current={page} onselect={(p) => (page = p)} />
      {/if}
      {#if !view}
        {#key attempted}
          <ErrorSummary errors={summary} />
        {/key}
      {/if}
      {#if !hasFields}
        <p class="py-8 text-center text-sm text-muted-foreground">{m.form_no_fields()}</p>
      {/if}
      <!-- The page heading and description of v3's renderPageGroup (form-renderer/FormRenderer.svelte:169-182). -->
      {#if heading}
        <h4 class="border-b border-border pb-2 text-sm font-semibold text-foreground">{heading}</h4>
      {/if}
      {#if pageHint}
        <p class="text-sm whitespace-pre-line text-muted-foreground">{pageHint}</p>
      {/if}
      <div class="space-y-4">
        {#each lines as line (line[0]?.f.key)}
          <div class="flex flex-wrap gap-4">
            {#each line as row (row.f.key)}
              <div class={COLUMN_CLASS[row.column]} data-column={row.column}>
                <FieldInput
                  field={row.f}
                  value={row.value}
                  {locale}
                  required={row.required}
                  readonly={row.readonly}
                  offered={row.offered}
                  waiting={row.waiting}
                  {view}
                  error={errorOf(row.f)}
                  choices={choices?.[row.f.key]}
                  {tool}
                  onchange={(v: Json) => session.set(row.f.key, v)}
                />
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
    {#if view}
      <!-- The record view: page navigation only, nothing to send. -->
      {#if pageCount > 1}
        <div
          class="sticky bottom-0 border-t border-border bg-background print:hidden"
          data-testid="form-footer"
        >
          <div class="flex gap-2 p-4">
            <Button
              type="button"
              variant="outline"
              class="flex-1"
              style={`min-height:${TARGET_SIZE.primary}px`}
              disabled={page === 0}
              onclick={() => (page -= 1)}
            >
              <ChevronLeft class="mr-1 h-4 w-4" aria-hidden="true" />
              {m.form_back()}
            </Button>
            <Button
              type="button"
              variant="outline"
              class="flex-1"
              style={`min-height:${TARGET_SIZE.primary}px`}
              disabled={last}
              onclick={() => (page += 1)}
            >
              {m.form_next()}
              <ChevronRight class="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      {/if}
    {:else}
      <!-- Thumb zone: the footer sticks to the bottom edge of the scroll area (v3 FormFillTool.svelte:407-445). -->
      <div class="sticky bottom-0 border-t border-border bg-background" data-testid="form-footer">
        <div class="flex gap-2 p-4">
          {#if page > 0}
            <Button
              type="button"
              variant="outline"
              class="flex-1"
              style={`min-height:${TARGET_SIZE.primary}px`}
              disabled={submitting}
              onclick={() => (page -= 1)}
            >
              <ChevronLeft class="mr-1 h-4 w-4" aria-hidden="true" />
              {m.form_back()}
            </Button>
          {:else if oncancel}
            <Button
              type="button"
              variant="outline"
              class="flex-1"
              style={`min-height:${TARGET_SIZE.primary}px`}
              disabled={submitting}
              onclick={oncancel}
            >
              {cancelLabel ?? m.form_cancel()}
            </Button>
          {/if}
          <!-- Enter in a field presses it too: the form handler pages on, or submits on the last page. -->
          <Button
            type="submit"
            class="flex-1"
            style={`min-height:${TARGET_SIZE.primary}px`}
            disabled={submitting}
          >
            {#if !last}
              {m.form_next()}
              <ChevronRight class="ml-1 h-4 w-4" aria-hidden="true" />
            {:else if submitting}
              <Loader2 class="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {m.form_submitting()}
            {:else}
              {#if continues}
                <ChevronRight class="order-last ml-1 h-4 w-4" aria-hidden="true" />
              {:else}
                <Send class="mr-2 h-4 w-4" aria-hidden="true" />
              {/if}
              {hasFields ? (submitLabel ?? m.form_submit()) : m.form_create_entry()}
            {/if}
          </Button>
        </div>
      </div>
    {/if}
  {/key}
</form>

{#if pending && !view}
  <ClearingDialog fields={pending} onconfirm={confirmClear} oncancel={() => (pending = undefined)} />
{/if}
