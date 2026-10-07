<script lang="ts">
  // v3 `StartupSection.svelte:286-350` "Sichtbare Workflows": a label with an "Alle" switch, one bordered row per
  // Objektart (expand chevron only when it has values, checkbox disabled while "Alle" is on, name) and, expanded, the
  // list "Phasen / Werte, die beim Start sichtbar sind" with a checkbox per value. v4: the Objektart is `types.<t>`,
  // the values are those of its classifying property or stage (`on_at_start`, `values_at_start`, A-040).
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { StartType, StartTypes } from './start-types';

  let {
    types,
    locale,
    all = $bindable(),
    choice = $bindable(),
  }: {
    types: readonly StartType[];
    locale: Locale;
    /** The "Alle" switch: every Objektart is on. */
    all: boolean;
    /** What is chosen per Objektart (starts from the saved state). */
    choice: Record<string, { on: boolean; values: readonly string[] | null }>;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let expanded = $state<ReadonlySet<string>>(new Set());
  function toggleExpanded(key: string): void {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

  function setAll(on: boolean): void {
    all = on;
    // v3 kept the list the admin had; v4 shows the current state, so "Alle" off starts from everything on.
    if (on) for (const ty of types) choice[ty.key] = { on: true, values: choice[ty.key]?.values ?? null };
  }

  const valueOn = (ty: StartType, value: string): boolean => {
    const list = choice[ty.key]?.values;
    return list === null || list === undefined || list.includes(value);
  };

  function toggleValue(ty: StartType, value: string, on: boolean): void {
    const current = choice[ty.key]?.values ?? ty.values.map((v) => v.value);
    const set = new Set(current);
    if (on) set.add(value);
    else set.delete(value);
    choice[ty.key] = {
      on: choice[ty.key]?.on ?? true,
      values: ty.values.map((v) => v.value).filter((v) => set.has(v)),
    };
  }
</script>

<section class="flex flex-col gap-2" data-testid="startup-types">
  <div class="flex items-center justify-between">
    <Label>{t('settings_startup_types')}</Label>
    <label class="flex items-center gap-2 text-sm">
      <Switch checked={all} onCheckedChange={setAll} aria-label={t('settings_startup_all')} />
      {t('settings_startup_all')}
    </label>
  </div>
  {#if types.length === 0}
    <p class="text-sm text-muted-foreground">{t('settings_startup_no_types')}</p>
  {:else}
    <div class="flex flex-col gap-1">
      {#each types as ty (ty.key)}
        {@const open = expanded.has(ty.key)}
        <div class="rounded-md border" data-type={ty.key}>
          <div class="flex items-center gap-2 p-2">
            {#if ty.values.length > 0}
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
                aria-label={t('settings_startup_expand')}
                aria-expanded={open}
                onclick={() => toggleExpanded(ty.key)}
              >
                {#if open}
                  <ChevronDown class="h-3.5 w-3.5" />
                {:else}
                  <ChevronRight class="h-3.5 w-3.5" />
                {/if}
              </button>
            {:else}
              <span class="inline-block h-5 w-5"></span>
            {/if}
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={all}
                checked={all || (choice[ty.key]?.on ?? true)}
                onchange={(e) =>
                  (choice[ty.key] = { on: e.currentTarget.checked, values: choice[ty.key]?.values ?? null })}
              />
              {ty.label}
            </label>
          </div>
          {#if ty.values.length > 0 && open}
            <div class="flex flex-col gap-1 border-t px-2 py-2 pl-10" data-testid="startup-values-{ty.key}">
              <p class="text-xs text-muted-foreground">
                {ty.mode === 'stage'
                  ? t('settings_startup_stages_at_start')
                  : t('settings_startup_values_at_start')}
              </p>
              {#each ty.values as v (v.value)}
                <label class="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={valueOn(ty, v.value)}
                    onchange={(e) => toggleValue(ty, v.value, e.currentTarget.checked)}
                  />
                  {v.label}
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
