<script lang="ts">
  // The Versionen page (v3 `releases/+page.svelte`, "Releases"): h1 with the History icon, v3's empty text, one row per
  // version. v4 keeps the working parts v3 lacked (owner §10.8): rollback per row, compare of two ticked rows, the
  // template upgrade offer and "Entwurf verwerfen" (a3 row 99), all confirmed in v3's AlertDialog.
  import History from '@lucide/svelte/icons/history';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import type { DeployWarning, Plan } from '@ueberblick/builder';
  import { adminMessage } from '../../../shell/messages';
  import type { Locale } from '../../../shell/locale';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import DiffView from './DiffView.svelte';
  import PinMoveDialog from './PinMoveDialog.svelte';
  import UpgradeOffer from './UpgradeOffer.svelte';
  import VersionRow from './VersionRow.svelte';
  import type { ActionAnswer, VersionsCalls, VersionsPageData } from './types';

  interface Props {
    locale: Locale;
    data: VersionsPageData;
    calls: VersionsCalls;
    /** Objekte still pinned to each old version (`version` to count), from the server; a version without pins is absent. */
    pinned: Readonly<Record<number, number>>;
    /** The move went through: the page reads its list and counts again. */
    onmoved: () => void;
  }
  let { locale, data, calls, pinned, onmoved }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let busy = $state(false);
  let rollbackOf = $state<number | null>(null);
  let rollbackOpen = $state(false);
  let discardOpen = $state(false);
  /** The old version whose pinned Objekte the dialog moves (WP-368, owner P3); `null` while it is closed. */
  let moveOf = $state<number | null>(null);
  let selected = $state<number[]>([]);
  let compared = $state<{ from: number; to: number; plan: Plan } | null>(null);
  let notice = $state<{ ok: boolean; text: string; warnings: readonly DeployWarning[] } | null>(null);

  const reasons: Record<string, Parameters<typeof adminMessage>[1]> = {
    problems: 'versions_problems',
    mapping_required: 'versions_mapping_required',
  };
  const fail = (a: Extract<ActionAnswer, { ok: false }>): string => t(reasons[a.reason] ?? 'versions_failed');

  /** Runs one call; a failed answer or an error shows as the alert, an ok one as the status line. */
  async function run(
    call: () => Promise<ActionAnswer>,
    ok: (a: Extract<ActionAnswer, { ok: true }>) => string,
  ) {
    busy = true;
    notice = null;
    try {
      const a = await call();
      notice = a.ok
        ? { ok: true, text: ok(a), warnings: a.warnings ?? [] }
        : { ok: false, text: fail(a), warnings: [] };
      return a;
    } catch {
      notice = { ok: false, text: t('versions_failed'), warnings: [] };
      return undefined;
    } finally {
      busy = false;
    }
  }

  const rollback = (version: number) =>
    run(
      () => calls.rollback(version),
      (a) => t('versions_rolled_back', { version: a.version ?? version }),
    );
  const discard = () =>
    run(
      () => calls.discard(),
      () => t('versions_discarded'),
    );
  async function compare(): Promise<void> {
    const [from, to] = [...selected].sort((a, b) => a - b);
    if (from === undefined || to === undefined) return;
    const a = await run(
      () => calls.compare(from, to),
      () => '',
    );
    if (a?.ok && a.plan) {
      compared = { from, to, plan: a.plan };
      notice = null;
    }
  }
  const upgrade = (overlay: string, mappings: Record<string, unknown>) =>
    run(
      () => calls.upgrade(overlay, mappings),
      (a) => t('versions_upgraded', { version: a.version ?? 0 }),
    );

  function toggle(version: number, on: boolean): void {
    compared = null;
    selected = on ? [...selected, version].slice(-2) : selected.filter((v) => v !== version);
  }
  const hasDeployed = $derived(data.versions.some((v) => v.status === 'deployed'));
</script>

<svelte:head><title>{t('versions_title')} - {t('product')}</title></svelte:head>

<div class="mx-auto max-w-3xl">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
    <h1 class="flex items-center gap-2 text-2xl font-bold">
      <History class="h-6 w-6" />
      {t('versions_title')}
    </h1>
    {#if hasDeployed}
      <Button variant="outline" disabled={busy} onclick={() => (discardOpen = true)}>
        {t('versions_discard')}
      </Button>
    {/if}
  </div>

  {#if notice}
    <div role={notice.ok ? 'status' : 'alert'} class="mb-4 rounded-lg border p-3 text-sm" data-ok={notice.ok}>
      <p class={notice.ok ? '' : 'text-destructive'}>{notice.text}</p>
      {#if notice.warnings.length > 0}
        <h4 class="mt-2 font-semibold">{t('versions_warnings')}</h4>
        <p class="text-muted-foreground">{t('versions_warnings_hint')}</p>
        <ul class="list-disc pl-5">
          {#each notice.warnings as w (`${w.code}:${w.path}`)}
            <li data-code={w.code}><code class="break-all text-xs">{w.path}</code> {w.message}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if data.upgrade}
    <UpgradeOffer {locale} data={data.upgrade} {busy} onupgrade={upgrade} />
  {/if}

  {#if !data.versions.length}
    <p class="text-muted-foreground">{t('versions_empty')}</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.versions as line (line.version)}
        <VersionRow {locale} {line}>
          {#snippet lead()}
            <Checkbox
              aria-label={t('versions_select', { version: line.version })}
              checked={selected.includes(line.version)}
              onCheckedChange={(on) => toggle(line.version, on === true)}
            />
          {/snippet}
          {#snippet actions()}
            {#if line.status !== 'deployed' && (pinned[line.version] ?? 0) > 0}
              <span class="text-sm text-muted-foreground" data-testid="pinned-count"
                >{t('versions_pinned', { count: pinned[line.version] ?? 0 })}</span
              >
              <Button variant="outline" size="sm" disabled={busy} onclick={() => (moveOf = line.version)}>
                {t('versions_move')}
              </Button>
            {/if}
            {#if line.status !== 'deployed'}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onclick={() => {
                  rollbackOf = line.version;
                  rollbackOpen = true;
                }}
              >
                {t('versions_rollback')}
              </Button>
            {/if}
          {/snippet}
        </VersionRow>
      {/each}
    </ul>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={busy || selected.length !== 2} onclick={compare}>
        {t('versions_compare')}
      </Button>
      {#if selected.length !== 2}
        <p class="text-sm text-muted-foreground">{t('versions_compare_hint')}</p>
      {/if}
    </div>

    {#if compared}
      <section class="mt-4" aria-labelledby="versions-compared">
        <h2 id="versions-compared" class="mb-2 text-lg font-semibold">
          {t('versions_compare_title', { from: compared.from, to: compared.to })}
        </h2>
        <DiffView {locale} plan={compared.plan} />
      </section>
    {/if}
  {/if}
</div>

<PinMoveDialog {locale} version={moveOf} {calls} onclose={() => (moveOf = null)} {onmoved} />
<ConfirmDialog
  bind:open={rollbackOpen}
  title={t('versions_rollback_title', { version: rollbackOf ?? 0 })}
  body={t('versions_rollback_body', { version: rollbackOf ?? 0 })}
  confirm={t('versions_rollback_confirm')}
  cancel={t('versions_cancel')}
  onconfirm={() => {
    const v = rollbackOf;
    if (v !== null) void rollback(v);
  }}
/>
<ConfirmDialog
  bind:open={discardOpen}
  destructive
  title={t('versions_discard_title')}
  body={t('versions_discard_body')}
  confirm={t('versions_discard_confirm')}
  cancel={t('versions_cancel')}
  onconfirm={() => void discard()}
/>
