<script lang="ts">
  // "Projektdatei vergleichen" (WP-506, owner answer 2026-10-05): the whole project file as YAML, live against draft, as a
  // red/green side-by-side line diff (live left, draft right, changed lines paired; one scroll container keeps both in sync). One component for the deploy overview and the Projektstatus section (R1). Unchanged runs are folded
  // (context lines stay) so a file of thousands of lines renders a few rows; a folded row opens on tap. On a phone the two-column grid scrolls sideways. Never published: every line is new.
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { DeployClient } from './deploy-client';
  import { collapse, DIFF_OP, lineDiff, splitLines, type LineOp } from '../diff/line-diff';
  import { pairRows, type SideRow } from '../diff/side-by-side';

  interface Props {
    locale: Locale;
    client: Pick<DeployClient, 'compare'>;
  }
  let { locale, client }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const CONTEXT = 3;
  let open = $state(false);
  let loading = $state(false);
  let failed = $state(false);
  let ops = $state<readonly LineOp[] | null>(null);
  let first = $state(false);
  let expanded = $state<ReadonlySet<number>>(new Set());

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    loading = true;
    failed = false;
    expanded = new Set();
    const files = await client.compare();
    loading = false;
    if (files === null || files.draft === null) {
      failed = true;
      ops = null;
      return;
    }
    first = files.live === null;
    ops = lineDiff(splitLines(files.live ?? ''), splitLines(files.draft));
  }

  const sideRows = $derived<readonly SideRow[]>(
    ops === null ? [] : pairRows(collapse(ops, CONTEXT), ops, expanded),
  );
  const added = $derived(ops?.filter((o) => o.op === DIFF_OP.add).length ?? 0);
  const removed = $derived(ops?.filter((o) => o.op === DIFF_OP.remove).length ?? 0);

  const cell = 'whitespace-pre-wrap break-all px-2';
  const markCls = 'inline-block w-4 select-none';
  const tone = {
    add: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200',
    remove: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  } as const;

  function unfold(from: number): void {
    expanded = new Set([...expanded, from]);
  }
</script>

<div data-testid="project-compare">
  <button
    type="button"
    class="min-h-11 rounded-md border px-3 text-sm sm:min-h-9"
    aria-expanded={open}
    onclick={() => void toggle()}
  >
    {t('compare_button')}
  </button>

  {#if open}
    <section class="mt-2" aria-label={t('compare_title')} data-testid="compare-body">
      {#if loading}
        <p class="text-sm text-muted-foreground" role="status">{t('compare_loading')}</p>
      {:else if failed}
        <p class="text-sm text-destructive" role="alert">{t('compare_failed')}</p>
      {:else if ops !== null}
        {#if added === 0 && removed === 0}
          <p class="text-sm text-muted-foreground" role="status">{t('compare_none')}</p>
        {:else}
          <p class="mb-1 text-xs text-muted-foreground" role="status" data-testid="compare-summary">
            {first ? `${t('compare_first')} ` : ''}{t('compare_summary', { added, removed })}
          </p>
          <div
            class="max-h-[60dvh] overflow-auto rounded-md border font-mono text-xs"
            role="region"
            aria-label={t('compare_title')}
            data-testid="compare-lines"
          >
            <div class="min-w-[44rem]" data-testid="compare-grid">
              <div class="sticky top-0 z-10 grid grid-cols-2 border-b bg-muted font-sans font-medium">
                <span class="px-2 py-1">{t('compare_old')}</span>
                <span class="border-l px-2 py-1">{t('compare_new')}</span>
              </div>
              {#each sideRows as row (row.key)}
                {#if row.kind === 'folded'}
                  <button
                    type="button"
                    class="block min-h-8 w-full bg-muted px-2 text-left text-muted-foreground"
                    onclick={() => unfold(row.from)}
                  >
                    {t('compare_folded', { count: row.count })}
                  </button>
                {:else if row.kind === 'equal'}
                  <div class="grid grid-cols-2" data-row="equal">
                    <div class={cell}><span class={markCls} aria-hidden="true"> </span>{row.line.text}</div>
                    <div class={`${cell} border-l`}>
                      <span class={markCls} aria-hidden="true"> </span>{row.line.text}
                    </div>
                  </div>
                {:else}
                  <div class="grid grid-cols-2" data-row="pair">
                    {#if row.left}
                      <div
                        class={`${cell} ${tone.remove}`}
                        data-op="remove"
                        role="group"
                        aria-label={t('compare_removed_line')}
                      >
                        <span class={markCls} aria-hidden="true">-</span>{row.left.text}
                      </div>
                    {:else}
                      <div class={`${cell} bg-muted/40`} aria-hidden="true"></div>
                    {/if}
                    {#if row.right}
                      <div
                        class={`${cell} border-l ${tone.add}`}
                        data-op="add"
                        role="group"
                        aria-label={t('compare_added_line')}
                      >
                        <span class={markCls} aria-hidden="true">+</span>{row.right.text}
                      </div>
                    {:else}
                      <div class={`${cell} border-l bg-muted/40`} aria-hidden="true"></div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</div>
