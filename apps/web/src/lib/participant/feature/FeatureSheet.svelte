<script lang="ts">
  // v3's feature sheet (the detail module of the participant map): header with the Objektart and "main value - time ago",
  // the action row, and the tabs Aktivität and Daten. Presentational: the device reads and the task starts happen in
  // the host (`sheet-data.ts`). The Aktivität timeline is a slot (`activity`, WP-634); without it v3's empty state.
  import { LAYER } from '../layers';
  import type { Snippet } from 'svelte';
  import AtSign from '@lucide/svelte/icons/at-sign';
  import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
  import type { FeatureId, Instant, Key } from '@ueberblick/core/model';
  import type { FeatureSheetModel } from '@ueberblick/ui';
  import { ModuleShell } from '@ueberblick/ui';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import { message, type Locale } from '../messages';
  import ActionRow from './ActionRow.svelte';
  import DataTab from './DataTab.svelte';
  import QuickEditData from './QuickEditData.svelte';
  import type { QuickEdit } from './quick-edit.svelte';
  import type { PresentedTask } from './task-presentation';
  import { ago } from './ago';

  interface Props {
    open: boolean;
    /** The model with the tasks as the action row draws them (button label, colour, icon, confirmation). */
    model: FeatureSheetModel & { readonly tasks: readonly PresentedTask[] };
    locale: Locale;
    /** The clock port's reading, for "vor 2 Std". */
    now: Instant;
    onclose: () => void;
    onstart: (task: Key) => void;
    onopen: (id: FeatureId) => void;
    /** An inline quick edit in progress: the Daten tab is editable, the action row is Abbrechen / Speichern. */
    quickEdit?: QuickEdit | undefined;
    onsave?: (() => void) | undefined;
    /** The Aktivität timeline; it gets a function that switches to the Daten tab (v3: a stage header opens Daten). */
    activity?: Snippet<[() => void]> | undefined;
    /** v3's relation path in the header (WP-647); not drawn while a quick edit runs, the title then names the task. */
    path?: Snippet | undefined;
    /** v3's run notices at the top of the body (WP-647). */
    notices?: Snippet | undefined;
    /** v3's relation level: replaces the body with the children of one relation (WP-647). */
    relation?: Snippet | undefined;
    /** Tasks the relation menu offers as "{name} anlegen"; v3 has no such button in the action row. */
    createTasks?: ReadonlySet<Key> | undefined;
    /** A task form in place of the body, in the same shell (v3 FormFillTool inside the detail module, :1164). */
    form?: Snippet | undefined;
    /** "Im Chat erwähnen" (the header ⋮ menu): given only when the person has the chat. Not offered during a form or a quick edit. */
    onmention?: (() => void) | undefined;
  }
  let {
    open,
    model,
    locale,
    now,
    onclose,
    onstart,
    onopen,
    activity,
    quickEdit,
    onsave,
    path,
    notices,
    relation,
    createTasks,
    form,
    onmention,
  }: Props = $props();
  const offered = $derived(
    createTasks === undefined ? model.tasks : model.tasks.filter((t) => !createTasks.has(t.key)),
  );

  // v3 :485-492: the menu is shown outside task and edit flows, and has this one item.
  const canMention = $derived(onmention !== undefined && form === undefined && quickEdit === undefined);

  let expanded = $state(false);
  let tab = $state('activity');

  // The quick edit opens on the Daten tab (v3 :613).
  $effect(() => {
    if (quickEdit) tab = 'data';
  });

  // A form needs room: it opens full height on a phone (v3 shares the detail's height, which people expand first).
  $effect(() => {
    if (form) expanded = true;
  });

  const subtitle = $derived.by(() => {
    const when = model.updatedAt === undefined ? '' : ago(model.updatedAt, now, locale);
    return when === '' ? model.title : `${model.title} · ${when}`;
  });
</script>

{#snippet headerActions()}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="flex min-h-11 min-w-11 items-center justify-center rounded p-2 transition-colors hover:bg-primary-foreground/10"
      aria-label={message(locale, 'feature_more_actions')}
      onclick={(e: MouseEvent) => e.stopPropagation()}
    >
      <EllipsisVertical class="h-4 w-4" aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class={LAYER.menu}>
      <DropdownMenu.Item onclick={() => onmention?.()}>
        <AtSign class="mr-2 h-4 w-4" aria-hidden="true" />
        {message(locale, 'feature_mention_in_chat')}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<ModuleShell
  {open}
  bind:expanded
  title={quickEdit?.title ?? model.typeLabel}
  label={model.title}
  {subtitle}
  toggleLabel={message(locale, 'feature_toggle')}
  closeLabel={message(locale, 'feature_close')}
  {onclose}
  testid="feature-sheet"
  titleContent={quickEdit === undefined && form === undefined ? path : undefined}
  headerActions={canMention ? headerActions : undefined}
>
  {#if form}
    {@render form()}
  {:else if relation}
    <div class="p-4">{@render relation()}</div>
  {:else}
    <div class="p-4">
      {@render notices?.()}
      <ActionRow
        tasks={offered}
        label={message(locale, 'feature_actions')}
        {locale}
        {onstart}
        edit={quickEdit === undefined || onsave === undefined
          ? undefined
          : { saving: quickEdit.saving, oncancel: quickEdit.cancel, onsave }}
      />

      <Tabs.Root bind:value={tab}>
        <Tabs.List class="grid w-full grid-cols-2">
          <Tabs.Trigger value="activity" class="text-xs sm:text-sm"
            >{message(locale, 'feature_tab_activity')}</Tabs.Trigger
          >
          <Tabs.Trigger value="data" class="text-xs sm:text-sm"
            >{message(locale, 'feature_tab_data')}</Tabs.Trigger
          >
        </Tabs.List>
        <Tabs.Content value="activity" class="pt-4">
          {#if activity}
            <!-- Built only while active, like Daten: the hidden panel would cost sheet-open time (R14). -->
            {#if tab === 'activity'}{@render activity(() => (tab = 'data'))}{/if}
          {:else}
            <p class="py-12 text-center text-sm text-muted-foreground">
              {message(locale, 'feature_no_activity')}
            </p>
          {/if}
        </Tabs.Content>
        <Tabs.Content value="data" class="pt-4">
          {#if tab === 'data'}
            <!-- Built only while active: bits-ui renders inactive panels (hidden), and that render cost
               lands on the sheet-open budget (R14). -->
            {#if quickEdit}
              <QuickEditData {model} {locale} edit={quickEdit} />
            {:else}
              <DataTab {model} {locale} {onopen} />
            {/if}
          {/if}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  {/if}
</ModuleShell>
