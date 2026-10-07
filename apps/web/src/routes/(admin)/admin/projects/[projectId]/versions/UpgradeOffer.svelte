<script lang="ts">
  // The template upgrade offer (a3 row 101, engine-new; the lens's `UpgradeWizard`): "Vorlage <Name>: Version <x>
  // verfügbar" above the list, the conflicts per key ("meinen Wert behalten" / "Vorlage übernehmen"), then the same
  // mappings as any deploy, then "Aktualisieren und veröffentlichen". The pure model stays in `@ueberblick/builder`.
  import { merge, type KeyPath } from '@ueberblick/core';
  import {
    RESOLUTIONS,
    UNRESOLVED_CHOICES,
    buildPlan,
    mappingsComplete,
    openProject,
    resolveUpgrade,
    startUpgrade,
    type Mapping,
    type Resolution,
    type UnresolvedChoice,
  } from '@ueberblick/builder';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Card from '@ueberblick/ui/components/ui/card';
  import { adminMessage } from '../../../shell/messages';
  import type { Locale } from '../../../shell/locale';
  import DiffView from './DiffView.svelte';
  import type { UpgradeData } from './types';

  interface Props {
    locale: Locale;
    data: UpgradeData;
    busy: boolean;
    onupgrade: (overlay: string, mappings: Record<string, Mapping>) => void;
  }
  let { locale, data, busy, onupgrade }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const doc = $derived(openProject(data.templateSrc, data.overlaySrc));
  const input = $derived({ old: doc.template, overlay: doc.overlay(), next: data.offer.template });
  const session = $derived(startUpgrade(input));
  let conflicts = $state<Record<KeyPath, Resolution | undefined>>({});
  let unresolved = $state<Record<KeyPath, UnresolvedChoice | undefined>>({});
  let chosen = $state<Record<KeyPath, Mapping | undefined>>({});

  const outcome = $derived(resolveUpgrade(input, { conflicts, unresolved }));
  const plan = $derived(
    outcome.ok
      ? buildPlan({
          deployed: data.deployed,
          effective: merge(data.offer.template, outcome.overlay).file,
          featureCounts: data.featureCounts,
        })
      : undefined,
  );
  const ready = $derived(
    outcome.ok && outcome.issues.length === 0 && plan !== undefined && mappingsComplete(plan, chosen),
  );
  const show = (v: unknown): string => JSON.stringify(v);
  const defined = (m: Record<KeyPath, Mapping | undefined>): Record<KeyPath, Mapping> =>
    Object.fromEntries(Object.entries(m).filter((e): e is [string, Mapping] => e[1] !== undefined));
</script>

<Card.Root class="mb-4" data-testid="upgrade-offer">
  <Card.Header>
    <Card.Title>
      {t('versions_upgrade_title', { template: data.offer.template.template.key, to: data.offer.to })}
    </Card.Title>
    <Card.Description>
      {t('versions_upgrade_subtitle', { from: data.offer.from, n: session.autoApplied.length })}
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3">
    {#if session.conflicts.length > 0}
      <h4 class="text-sm font-semibold">{t('versions_upgrade_conflicts')}</h4>
      {#each session.conflicts as c (c.path)}
        <fieldset class="rounded-lg border p-3" data-path={c.path}>
          <legend class="px-1"><code class="break-all text-xs">{c.path}</code></legend>
          <dl class="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="text-muted-foreground">{t('versions_upgrade_base')}</dt>
            <dd class="break-all"><code>{show(c.base)}</code></dd>
            <dt class="text-muted-foreground">{t('versions_upgrade_theirs')}</dt>
            <dd class="break-all"><code>{show(c.theirs)}</code></dd>
            <dt class="text-muted-foreground">{t('versions_upgrade_ours')}</dt>
            <dd class="break-all"><code>{show(c.ours)}</code></dd>
          </dl>
          {#each RESOLUTIONS as r (r)}
            <label class="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name={`conflict-${c.path}`} value={r} bind:group={conflicts[c.path]} />
              {t(r === 'overlay' ? 'versions_upgrade_keep_mine' : 'versions_upgrade_take_template')}
            </label>
          {/each}
        </fieldset>
      {/each}
    {/if}

    {#if session.unresolved.length > 0}
      <h4 class="text-sm font-semibold">{t('versions_upgrade_unresolved')}</h4>
      <p class="text-sm text-muted-foreground">{t('versions_upgrade_unresolved_hint')}</p>
      {#each session.unresolved as p (p)}
        <fieldset class="rounded-lg border p-3" data-path={p}>
          <legend class="px-1"><code class="break-all text-xs">{p}</code></legend>
          {#each UNRESOLVED_CHOICES as choice (choice)}
            <label class="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name={`unresolved-${p}`} value={choice} bind:group={unresolved[p]} />
              {t(choice === 'drop' ? 'versions_upgrade_drop' : 'versions_upgrade_keep')}
            </label>
          {/each}
        </fieldset>
      {/each}
    {/if}

    {#if !outcome.ok}
      <p role="status" class="text-sm">{t('versions_upgrade_pending', { n: outcome.pending.length })}</p>
    {:else}
      {#if outcome.issues.length > 0}
        <ul role="alert" class="text-sm text-destructive">
          {#each outcome.issues as i (`${i.code}:${i.path}`)}
            <li data-path={i.path}><code>{i.path}</code> {i.message}</li>
          {/each}
        </ul>
      {/if}
      {#if plan}<DiffView {locale} {plan} mapping bind:chosen />{/if}
    {/if}
  </Card.Content>
  <Card.Footer>
    <Button
      disabled={!ready || busy}
      onclick={() => outcome.ok && onupgrade(outcome.text, defined(chosen))}
      class="w-full sm:w-auto"
    >
      {t('versions_upgrade_run')}
    </Button>
  </Card.Footer>
</Card.Root>
