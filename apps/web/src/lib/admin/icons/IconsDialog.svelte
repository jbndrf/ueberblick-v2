<script lang="ts">
  // The icon designer of an Objektart (v3 `workflow-icon-designer.svelte`, opened from the data page's "Icons" button): an
  // overview and an editing view in one modal. Overview: the classifying property (new here: v3 picked it in the builder's
  // field-tag pane, v4 has no field tags, so it sits at the top of the designer), the type's own icon, and one row per
  // option of the classifying property with Festlegen / Bearbeiten / Entfernen. v3 listed stages and dropdown values
  // apart; the stage is a select property here, so one list serves both. Editing view: `IconEditor`.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Circle from '@lucide/svelte/icons/circle';
  import CircleStop from '@lucide/svelte/icons/circle-stop';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { resolveMarker } from '@ueberblick/core';
  import { markerSvgUrl } from '@ueberblick/ui';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Separator } from '@ueberblick/ui/components/ui/separator';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { IconsApi } from './api';
  import IconEditor from './IconEditor.svelte';
  import type { IconChoice, IconLook, IconResult, IconsKit, IconsState } from './types';

  let {
    open = $bindable(false),
    locale,
    name,
    kit,
    icons,
    api,
    onchanged,
    onstate,
  }: {
    open?: boolean;
    locale: Locale;
    /** The Objektart's name in the page language. */
    name: string;
    /** The builder's icon functions (the route hands them in). */
    kit: IconsKit;
    /** The look of the type as the draft has it. */
    icons: IconsState;
    /** Every answer of the server: the page keeps the new state. */
    onstate: (next: IconsState) => void;
    api: IconsApi;
    /** The draft changed: the shell's publish bar follows. */
    onchanged: () => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none';

  type Target = { readonly kind: 'marker' } | { readonly kind: 'value'; readonly key: string };
  let view = $state<'overview' | 'editing'>('overview');
  let target = $state<Target | null>(null);
  let refusal = $state<string | null>(null);
  let pending = $state<{ readonly property: string | null; readonly dropped: readonly string[] } | null>(
    null,
  );
  let confirmOpen = $state(false);
  const uid = $props.id();

  $effect(() => {
    if (open) {
      view = 'overview';
      target = null;
      refusal = null;
    }
  });

  const config = $derived({ marker: icons.marker ?? undefined, classify: icons.classify ?? undefined });
  const labelOfValue = (key: string): string => icons.options.find((o) => o.key === key)?.label ?? key;
  const isStage = $derived(icons.classify !== null && icons.classify.property === icons.stage);
  const hasOwn = (look: IconLook | undefined): boolean => look?.icon !== undefined;

  /** One answer of the server: the new state, or the refusal in place (and as a toast, as v3 did). */
  function take(r: IconResult): boolean {
    if (!r.ok) {
      refusal = r.message;
      toast.error(r.message);
      return false;
    }
    refusal = null;
    onstate(r.state);
    onchanged();
    return true;
  }

  async function applyProperty(property: string | null): Promise<void> {
    take(await api.call({ action: 'property', property }));
  }

  function onProperty(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value === '' ? null : select.value;
    const dropped = kit.droppedFor(icons, next);
    if (dropped.length === 0) {
      void applyProperty(next);
      return;
    }
    select.value = icons.classify?.property ?? ''; // stays until the admin confirms
    pending = { property: next, dropped };
    confirmOpen = true;
  }

  async function confirmDrop(): Promise<void> {
    const p = pending;
    pending = null;
    confirmOpen = false;
    if (p !== null) await applyProperty(p.property);
  }

  function edit(next: Target): void {
    target = next;
    refusal = null;
    view = 'editing';
  }

  async function clear(next: Target): Promise<void> {
    const r = await api.call(
      next.kind === 'marker' ? { action: 'clear_marker' } : { action: 'clear_value', value: next.key },
    );
    if (take(r)) toast.success(t('icons_cleared'));
  }

  const initial = $derived(
    target === null
      ? undefined
      : target.kind === 'marker'
        ? (icons.marker ?? undefined)
        : icons.classify?.values[target.key],
  );
  const editingLabel = $derived(
    target === null
      ? ''
      : target.kind === 'marker'
        ? t('icons_editing_marker', { name })
        : t(isStage ? 'icons_editing_stage' : 'icons_editing_value', { value: labelOfValue(target.key) }),
  );

  async function saveLook(look: IconLook): Promise<string | null> {
    if (target === null) return null;
    const r = await api.call(
      target.kind === 'marker'
        ? { action: 'set_marker', look }
        : { action: 'set_value', value: target.key, look },
    );
    if (!r.ok) return r.message;
    take(r);
    toast.success(t('icons_saved'));
    view = 'overview';
    target = null;
    return null;
  }

  const stageBadge = (o: IconChoice): { label: AdminKey; icon: typeof Play } | null =>
    o.stage === undefined
      ? null
      : o.stage.start
        ? { label: 'icons_stage_start', icon: Play }
        : o.stage.end
          ? { label: 'icons_stage_end', icon: CircleStop }
          : { label: 'icons_stage_step', icon: Square };
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    showCloseButton={view === 'overview'}
    data-testid="icons-dialog"
    class="flex h-[calc(100svh-2rem)] max-h-[calc(100svh-2rem)] max-w-full flex-col sm:h-auto sm:max-h-[85vh] {view ===
    'editing'
      ? 'sm:max-w-4xl'
      : 'sm:max-w-2xl'}"
  >
    {#if view === 'editing' && target !== null}
      <div class="flex items-center gap-3 border-b pb-3">
        <Button variant="ghost" size="sm" onclick={() => (view = 'overview')}>
          <ArrowLeft class="mr-1 h-4 w-4" />
          {t('icons_back')}
        </Button>
        <Separator orientation="vertical" class="h-5" />
        <span class="text-sm font-medium text-muted-foreground">{editingLabel}</span>
      </div>
      <IconEditor {locale} {kit} {initial} onsave={saveLook} oncancel={() => (view = 'overview')} />
    {:else}
      <Dialog.Header>
        <Dialog.Title>{t('icons_title')}</Dialog.Title>
        <Dialog.Description>{t('icons_subtitle', { name })}</Dialog.Description>
      </Dialog.Header>

      <div class="min-h-0 flex-1 space-y-6 overflow-y-auto">
        <div class="space-y-2">
          <Label
            for="{uid}-property"
            class="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t('icons_property')}
          </Label>
          <select
            id="{uid}-property"
            data-testid="icons-property"
            class={selectClass}
            value={icons.classify?.property ?? ''}
            onchange={onProperty}
          >
            <option value="">{t('icons_property_none')}</option>
            {#each icons.selects as p (p.key)}
              <option value={p.key}>{p.label}</option>
            {/each}
          </select>
          <p class="text-xs text-muted-foreground">{t('icons_property_hint')}</p>
        </div>

        {#if refusal}
          <p role="alert" data-testid="icons-refusal" class="text-sm text-destructive">{refusal}</p>
        {/if}

        <Separator />

        <div class="space-y-3" data-testid="icons-marker">
          <h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {t('icons_marker_heading')}
          </h3>
          <div class="flex items-center gap-4 rounded-lg border p-4">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/50">
              <img src={markerSvgUrl(resolveMarker({ marker: config.marker }, undefined), 32)} alt="" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium">
                {hasOwn(icons.marker ?? undefined) ? t('icons_custom_set') : t('icons_no_icon')}
              </div>
              <div class="text-xs text-muted-foreground">{t('icons_marker_hint')}</div>
            </div>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" onclick={() => edit({ kind: 'marker' })}>
                <Pencil class="mr-1 h-3 w-3" />
                {hasOwn(icons.marker ?? undefined) ? t('icons_edit') : t('icons_set_icon')}
              </Button>
              {#if icons.marker !== null}
                <Button variant="outline" size="sm" onclick={() => void clear({ kind: 'marker' })}>
                  <Trash2 class="h-3 w-3" />
                  <span class="sr-only">{t('icons_clear')}</span>
                </Button>
              {/if}
            </div>
          </div>
        </div>

        {#if icons.classify !== null}
          <Separator />
          <div class="space-y-3" data-testid="icons-values">
            <h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {t('icons_values_heading')}
              <span class="ml-1 font-normal normal-case"
                >({t('icons_values_count', { count: icons.options.length })})</span
              >
              {#if isStage}
                <span class="ml-1 text-xs font-normal normal-case">({t('icons_used_for_filter')})</span>
              {/if}
            </h3>
            {#if icons.options.length === 0}
              <p class="py-4 text-center text-sm text-muted-foreground">{t('icons_no_values')}</p>
            {:else}
              <p class="text-xs text-muted-foreground">{t('icons_values_hint')}</p>
              <ul class="space-y-2">
                {#each icons.options as o (o.key)}
                  {@const own = icons.classify.values[o.key]}
                  {@const badge = stageBadge(o)}
                  <li data-value={o.key} class="flex items-center gap-3 rounded-lg border p-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted/50">
                      {#if own !== undefined}
                        <img src={markerSvgUrl(resolveMarker(config, o.key), 24)} alt="" />
                      {:else if icons.marker?.icon !== undefined}
                        <img class="opacity-30" src={markerSvgUrl(resolveMarker(config, o.key), 20)} alt="" />
                      {:else}
                        <Circle class="h-3 w-3 text-muted-foreground/30" />
                      {/if}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-sm font-medium">{o.label}</span>
                        {#if badge !== null}
                          <Badge variant="secondary" class="text-xs">
                            <badge.icon class="mr-1 h-3 w-3" />
                            {t(badge.label)}
                          </Badge>
                        {/if}
                      </div>
                      <div class="text-xs text-muted-foreground">
                        {hasOwn(own) ? t('icons_custom_icon') : t('icons_uses_default')}
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <Button variant="ghost" size="sm" onclick={() => edit({ kind: 'value', key: o.key })}>
                        <Pencil class="mr-1 h-3 w-3" />
                        {own !== undefined ? t('icons_edit') : t('icons_set')}
                      </Button>
                      {#if own !== undefined}
                        <Button
                          variant="ghost"
                          size="sm"
                          onclick={() => void clear({ kind: 'value', key: o.key })}
                        >
                          <Trash2 class="h-3 w-3" />
                          <span class="sr-only">{t('icons_clear')}</span>
                        </Button>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>

      <Dialog.Footer>
        <Button variant="outline" onclick={() => (open = false)}>{t('icons_done')}</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmOpen}>
  <AlertDialog.Content data-testid="icons-drop-confirm">
    <AlertDialog.Header>
      <AlertDialog.Title>{t('icons_drop_title')}</AlertDialog.Title>
      <AlertDialog.Description>
        {t(pending?.property === null ? 'icons_drop_none' : 'icons_drop_switch', {
          count: pending?.dropped.length ?? 0,
          values: (pending?.dropped ?? []).map(labelOfValue).join(', '),
        })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={() => (pending = null)}>{t('icons_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => void confirmDrop()}>{t('icons_drop_confirm')}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
