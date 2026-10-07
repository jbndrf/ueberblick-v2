<script lang="ts">
  // One Objektart of the deploy overview (v3 `fork/+page.svelte:171-277`, one `<li>` of `.wf-list`): its name with the badge
  // neu / Tiefgreifende Änderung / Keine tiefgreifenden Änderungen and the Objekte it has, the diff in plain words, v3's
  // radio "Laufende Fälle ... belassen / migrieren" (only when running Objekte exist) and v3's "verschieben nach" rows for
  // what a removed stage, option or property still holds (a native select: the phone's own picker, as in v3).
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { ValueMapping } from '@ueberblick/server';
  import { VERSION_DEPLOY_CHOICES, type VersionDeployChoice } from '@ueberblick/core';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { lineText, nounText } from './entry-text';
  import { choiceOf, needsPick, type Choices, type Picks } from './overview-model';
  import type { DeployPlan, MappingView, PlanGroup } from './types';

  interface Props {
    locale: Locale;
    group: PlanGroup;
    plan: DeployPlan;
    choices: Choices;
    picks: Picks;
    onchoice: (type: string, choice: VersionDeployChoice) => void;
    onpick: (path: string, mapping: ValueMapping | undefined) => void;
  }
  let { locale, group, plan, choices, picks, onchoice, onpick }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const breaking = $derived(group.entries.filter((e) => e.breaking));
  const version = $derived(plan.versions.find((v) => v.type === group.type && v.running_floating > 0));
  const rows = $derived(plan.mappings.filter((m) => m.type === group.type && needsPick(plan, choices, m)));

  const current = (m: MappingView): string => {
    const p = picks[m.path];
    return p === undefined ? '' : 'discard' in p ? '$discard' : `to:${p.to}`;
  };
  function pick(m: MappingView, value: string): void {
    onpick(
      m.path,
      value === '' ? undefined : value === '$discard' ? { discard: true } : { to: value.slice(3) },
    );
  }
</script>

<li class="rounded-lg border p-3" data-testid="deploy-group" data-type={group.type ?? ''}>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
    <span class="font-semibold">{group.type === null ? t('deploy_group_project') : group.label}</span>
    {#if group.isNew}
      <span
        class="rounded bg-blue-100 px-1.5 py-0.5 text-[0.7rem] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
        >{t('deploy_badge_new')}</span
      >
    {:else if group.isRemoved}
      <span
        class="rounded bg-red-100 px-1.5 py-0.5 text-[0.7rem] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"
        >{t('deploy_badge_removed')}</span
      >
    {:else if group.type !== null && breaking.length > 0}
      <span
        class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[0.7rem] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      >
        <TriangleAlert class="size-3" />
        {t('deploy_badge_breaking', { count: breaking.length })}
      </span>
    {:else if group.type !== null}
      <span class="rounded bg-muted px-1.5 py-0.5 text-[0.7rem] font-semibold text-muted-foreground"
        >{t('deploy_badge_ok')}</span
      >
    {/if}
    {#if group.type !== null && group.objects > 0}
      <span class="text-xs text-muted-foreground sm:ml-auto"
        >{t('deploy_objects', { count: group.objects })}</span
      >
    {/if}
  </div>

  {#if group.entries.length > 0}
    <ul class="mt-2 flex flex-col gap-1 text-sm" aria-label={group.label}>
      {#each group.entries as e (e.path)}
        <li class="flex flex-wrap items-baseline gap-x-2" data-breaking={e.breaking || undefined}>
          <span>{lineText(locale, e)}</span>
          {#if e.parts !== undefined}
            <span class="text-xs text-muted-foreground" data-testid="deploy-line-parts"
              >({e.parts.join(', ')})</span
            >
          {/if}
          {#if e.breaking}<strong class="text-xs text-amber-700 dark:text-amber-300"
              >{t('deploy_line_breaking')}</strong
            >{/if}
          {#if e.affected !== undefined && e.affected > 0}
            <span class="text-xs text-muted-foreground"
              >{t('deploy_line_affected', { count: e.affected })}</span
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if group.type !== null && version}
    {@const type = group.type}
    <fieldset
      class="mt-3 flex flex-col gap-1 text-sm"
      aria-label={t('deploy_choice_legend', { type: group.label })}
    >
      {#each VERSION_DEPLOY_CHOICES.keys as c (c)}
        <label class="flex min-h-11 items-center gap-2 sm:min-h-0">
          <input
            type="radio"
            name={`choice-${type}`}
            value={c}
            checked={choiceOf(choices, type) === c}
            onchange={() => onchoice(type, c)}
          />
          {c === 'keep' ? t('deploy_choice_keep') : t('deploy_choice_move')}
        </label>
      {/each}
      <p class="text-xs text-muted-foreground" data-testid="deploy-choice-counts">
        {t('deploy_choice_counts', {
          running: version.running_floating,
          pinned: version.already_pinned,
          settled: version.settled_floating,
        })}
      </p>
    </fieldset>
  {/if}

  {#if rows.length > 0}
    <div class="mt-3 flex flex-col gap-2" data-testid="deploy-remap">
      <p class="text-xs text-muted-foreground">{t('deploy_remap_prompt')}</p>
      {#each rows as m (m.path)}
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-xs text-muted-foreground">{nounText(locale, m.path, m.stage)}</span>
          <code class="font-semibold">{m.name}</code>
          <span class="text-xs text-muted-foreground">{t('deploy_line_affected', { count: m.affected })}</span
          >
          <ArrowRight class="size-3 shrink-0 opacity-60" />
          <label class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">{t('deploy_remap_to')}</span>
            <select
              class="min-h-11 rounded-md border bg-background px-2 text-sm sm:min-h-8"
              aria-label={`${nounText(locale, m.path, m.stage)} ${m.name}: ${t('deploy_remap_to')}`}
              value={current(m)}
              onchange={(e) => pick(m, e.currentTarget.value)}
            >
              <option value="" disabled>{t('deploy_remap_choose')}</option>
              {#each m.choices as c (c.key)}
                <option value={`to:${c.key}`}>{c.label}</option>
              {/each}
              <option value="$discard">{t('deploy_remap_discard')}</option>
            </select>
          </label>
        </div>
      {/each}
    </div>
  {/if}
</li>
