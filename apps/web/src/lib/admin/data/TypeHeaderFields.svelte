<script lang="ts">
  // The one name / description / "Sichtbar für Rollen" block of an entity page header (v3 `data-viewer-header.svelte`, used for the
  // Objektart page and the table page alike; WP-425, R1): the name and description click to edit (pencil on hover, check and cross,
  // Enter saves, Escape cancels, an empty name is refused under the field), "Sichtbar für Rollen" is a multi-select (empty means every
  // role). Each save is one call the page applies to the draft and answers with its refusal, if any. `actions` sits right of the name,
  // `notes` below the roles. Without `editable` it shows the name and the description only.
  import { untrack, type Snippet } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import Pencil from '@lucide/svelte/icons/pencil';
  import X from '@lucide/svelte/icons/x';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { MultiSelect } from '@ueberblick/ui/components/ui/multi-select';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { HeaderAudience, HeaderResult } from './header-types';

  let {
    locale = 'de',
    prefix,
    name,
    description = '',
    audience,
    roles,
    editable = true,
    onName,
    onDescription,
    onRoles,
    actions,
    notes,
  }: {
    locale?: Locale;
    /** The test-id prefix of the page: `data` (Objektart) or `table` (Tabelle). */
    prefix: string;
    name: string;
    description?: string;
    audience: HeaderAudience;
    roles: readonly { readonly key: string; readonly label: string }[];
    /** False: the name and the description are shown, nothing is edited. */
    editable?: boolean;
    onName: (value: string) => Promise<HeaderResult>;
    onDescription: (value: string) => Promise<HeaderResult>;
    /** An empty list means every role (v3's "Alle"). */
    onRoles: (roles: string[]) => Promise<HeaderResult>;
    actions?: Snippet;
    notes?: Snippet;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let editingName = $state(false);
  let editingDescription = $state(false);
  let editingRoles = $state(false);
  let nameValue = $state('');
  let descriptionValue = $state('');
  let picked = $state<string[]>([]);
  /** The refusal, shown under the field it belongs to (v3 had none; an empty name was dropped silently). */
  let nameError = $state('');
  let descriptionError = $state('');
  let rolesError = $state('');

  async function saveName(): Promise<void> {
    const v = nameValue.trim();
    if (v === '') {
      nameError = t('data_name_empty');
      return;
    }
    if (v !== name) {
      const r = await onName(v);
      if (!r.ok) {
        nameError = r.message;
        return;
      }
    }
    editingName = false;
  }
  async function saveDescription(): Promise<void> {
    const v = descriptionValue.trim();
    if (v !== description) {
      const r = await onDescription(v);
      if (!r.ok) {
        descriptionError = r.message;
        return;
      }
    }
    editingDescription = false;
  }
  async function saveRoles(): Promise<void> {
    const r = await onRoles([...picked]);
    if (!r.ok) {
      rolesError = r.message;
      return;
    }
    editingRoles = false;
  }
  const startName = (): void => {
    nameValue = name;
    nameError = '';
    editingName = true;
  };
  const startDescription = (): void => {
    descriptionValue = description;
    descriptionError = '';
    editingDescription = true;
  };
  function startRoles(): void {
    picked = audience.kind === 'roles' ? untrack(() => [...audience.roles]) : [];
    rolesError = '';
    editingRoles = true;
  }
  const onKey =
    (save: () => void, cancel: () => void) =>
    (e: KeyboardEvent): void => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') cancel();
    };

  const named = $derived(
    audience.kind === 'roles' ? audience.roles.map((k) => roles.find((r) => r.key === k)?.label ?? k) : [],
  );
</script>

<div class="flex flex-col gap-2" data-testid="{prefix}-header">
  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      {#if editable && editingName}
        <div class="flex items-center gap-2">
          <Input
            bind:value={nameValue}
            oninput={() => (nameError = '')}
            onkeydown={onKey(
              () => void saveName(),
              () => (editingName = false),
            )}
            class="h-9 w-64 max-w-full text-2xl font-bold"
            aria-label={t('tbl_rename')}
            aria-invalid={nameError !== ''}
            data-testid="{prefix}-name-input"
            autofocus
          />
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            onclick={() => void saveName()}
            data-testid="{prefix}-name-save"
          >
            <Check class="h-4 w-4" />
            <span class="sr-only">{t('tbl_confirm')}</span>
          </Button>
          <Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => (editingName = false)}>
            <X class="h-4 w-4" />
            <span class="sr-only">{t('tbl_cancel')}</span>
          </Button>
        </div>
        {#if nameError}
          <p class="text-xs text-destructive" role="alert" data-testid="{prefix}-name-error">{nameError}</p>
        {/if}
      {:else if editable}
        <button
          type="button"
          class="group flex min-w-0 items-center gap-2 text-left transition-colors hover:text-foreground/80"
          onclick={startName}
          data-testid="{prefix}-name"
        >
          <h1 class="truncate text-2xl font-bold tracking-tight">{name}</h1>
          <Pencil
            class="h-4 w-4 shrink-0 opacity-50 transition-opacity group-hover:opacity-80 md:opacity-0"
          />
          <span class="sr-only">{t('tbl_rename')}</span>
        </button>
      {:else}
        <h1 class="min-w-0 truncate text-2xl font-bold tracking-tight">{name}</h1>
      {/if}
    </div>
    {#if actions}
      <div class="flex max-w-full min-w-0 flex-wrap items-center gap-2">{@render actions()}</div>
    {/if}
  </div>

  {#if editable && editingDescription}
    <div class="flex items-center gap-2">
      <Input
        bind:value={descriptionValue}
        oninput={() => (descriptionError = '')}
        onkeydown={onKey(
          () => void saveDescription(),
          () => (editingDescription = false),
        )}
        class="h-8 w-96 max-w-full text-sm"
        placeholder={t('tbl_add_desc')}
        aria-label={t('tbl_col_desc')}
        data-testid="{prefix}-description-input"
        autofocus
      />
      <Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => void saveDescription()}>
        <Check class="h-3 w-3" />
        <span class="sr-only">{t('tbl_confirm')}</span>
      </Button>
      <Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => (editingDescription = false)}>
        <X class="h-3 w-3" />
        <span class="sr-only">{t('tbl_cancel')}</span>
      </Button>
    </div>
    {#if descriptionError}
      <p class="text-xs text-destructive" role="alert">{descriptionError}</p>
    {/if}
  {:else if editable}
    <button
      type="button"
      class="group flex w-fit max-w-full items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground/70"
      onclick={startDescription}
      data-testid="{prefix}-description"
    >
      <span>{description || t('tbl_add_desc')}</span>
      <Pencil class="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-80 md:opacity-0" />
    </button>
  {:else if description}
    <p class="text-sm text-muted-foreground">{description}</p>
  {/if}

  {#if editable && roles.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-muted-foreground">{t('tbl_visible_to')}:</span>
      {#if audience.kind === 'property'}
        <span class="text-xs text-muted-foreground italic" data-testid="{prefix}-roles-property"
          >{t('data_roles_property')}</span
        >
      {:else if editingRoles}
        <div class="flex items-center gap-2">
          <MultiSelect
            bind:selected={picked}
            options={roles.map((r) => ({ value: r.key, label: r.label }))}
            class="min-w-[200px]"
            labels={{ placeholder: t('tbl_roles_ph') }}
          />
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7"
            onclick={() => void saveRoles()}
            data-testid="{prefix}-roles-confirm"
          >
            <Check class="h-3 w-3" />
            <span class="sr-only">{t('tbl_confirm')}</span>
          </Button>
          <Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => (editingRoles = false)}>
            <X class="h-3 w-3" />
            <span class="sr-only">{t('tbl_cancel')}</span>
          </Button>
        </div>
        {#if rolesError}
          <p class="w-full text-xs text-destructive" role="alert">{rolesError}</p>
        {/if}
      {:else}
        <button
          type="button"
          class="group flex flex-wrap items-center gap-1 transition-colors hover:text-foreground/70"
          onclick={startRoles}
          data-testid="{prefix}-roles"
        >
          {#each named as label (label)}
            <Badge variant="secondary" class="text-xs">{label}</Badge>
          {:else}
            <span class="text-xs text-muted-foreground italic"
              >{audience.kind === 'all' ? t('tbl_roles_all') : t('tbl_roles_none')}</span
            >
          {/each}
          <Pencil class="ml-1 h-3 w-3 opacity-50 transition-opacity group-hover:opacity-80 md:opacity-0" />
        </button>
      {/if}
    </div>
  {/if}

  {@render notes?.()}
</div>
