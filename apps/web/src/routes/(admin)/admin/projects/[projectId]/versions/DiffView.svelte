<script lang="ts">
  // The changes of a plan (the lens's `PlanView`): grouped per place, a "brechend" mark, the affected Objekte and, for an
  // upgrade, a mapping select per breaking change. The select is a native one on purpose: it is the mobile-friendly
  // picker on a phone (v3 used the same kind of select for the fork page's "verschieben nach").
  import type { KeyPath } from '@ueberblick/core';
  import type { Mapping, Plan } from '@ueberblick/builder';
  import { adminMessage } from '../../../shell/messages';
  import type { Locale } from '../../../shell/locale';

  interface Props {
    locale: Locale;
    plan: Plan;
    /** Show the mapping selects (an upgrade); a compare only lists the changes. */
    mapping?: boolean;
    chosen?: Record<KeyPath, Mapping | undefined>;
  }
  let { locale, plan, mapping = false, chosen = $bindable({}) }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const current = (path: KeyPath): string => {
    const m = chosen[path];
    return m === undefined ? '' : 'discard' in m ? '$discard' : `to:${m.to}`;
  };
  function pick(path: KeyPath, value: string): void {
    if (value === '') chosen[path] = undefined;
    else chosen[path] = value === '$discard' ? { discard: true } : { to: value.slice('to:'.length) };
  }
  const label = (change: string): Parameters<typeof adminMessage>[1] =>
    change === 'added'
      ? 'versions_diff_added'
      : change === 'removed'
        ? 'versions_diff_removed'
        : change === 'order_changed'
          ? 'versions_diff_order_changed'
          : 'versions_diff_changed';
</script>

{#if plan.entries.length === 0}
  <p class="text-sm text-muted-foreground">{t('versions_diff_empty')}</p>
{:else}
  <p role="status" class="mb-2 text-sm">
    {t('versions_diff_summary', {
      changes: plan.entries.length,
      entities: plan.entities.length,
      breaking: plan.breaking.length,
    })}
  </p>
  <ul class="flex flex-col gap-2">
    {#each plan.entities as e (e.path)}
      <li class="rounded-lg border p-3" data-path={e.path}>
        <h4 class="mb-1 text-sm font-semibold">
          {e.entity === undefined ? e.section : `${e.section} / ${e.entity}`}
        </h4>
        <ul class="flex flex-col gap-1">
          {#each e.changes as c (c.path)}
            <li class="flex flex-wrap items-center gap-2 text-sm" data-breaking={c.breaking || undefined}>
              <code class="break-all text-xs">{c.path}</code>
              <span class="text-muted-foreground">{t(label(c.change))}</span>
              {#if c.breaking}<strong class="text-destructive">{t('versions_diff_breaking')}</strong>{/if}
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>

  {#if plan.affected.length > 0}
    <section class="mt-3" aria-labelledby="versions-affected">
      <h4 id="versions-affected" class="mb-1 text-sm font-semibold">{t('versions_affected')}</h4>
      <ul class="text-sm">
        {#each plan.affected as a (a.type)}
          <li>{t('versions_affected_row', { type: a.type, n: a.features })}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if mapping && plan.mappings.length > 0}
    <section class="mt-3" aria-labelledby="versions-mappings">
      <h4 id="versions-mappings" class="mb-1 text-sm font-semibold">{t('versions_mappings')}</h4>
      <p class="mb-2 text-sm text-muted-foreground">{t('versions_mappings_hint')}</p>
      {#each plan.mappings as r (r.path)}
        <label class="mb-2 flex flex-col gap-1 text-sm">
          <code class="break-all text-xs">{r.path}</code>
          <select
            class="min-h-11 rounded-md border bg-background px-2 text-sm"
            value={current(r.path)}
            onchange={(e) => pick(r.path, e.currentTarget.value)}
          >
            <option value="">{t('versions_mapping_choose')}</option>
            {#each r.choices as c (c)}
              <option value={`to:${c}`}>{t('versions_mapping_to', { key: c })}</option>
            {/each}
            <option value="$discard">{t('versions_mapping_discard')}</option>
          </select>
        </label>
      {/each}
    </section>
  {/if}
{/if}
