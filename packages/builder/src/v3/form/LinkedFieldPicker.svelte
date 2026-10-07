<script lang="ts">
  // v3 `form-editor/RelatedFieldPicker.svelte` (B6, relation first): two conscious steps. 1. the relation (here the
  // task's declared `bind` entries: the linked Objekte; v3 offered the parent relations); 2. a property of the
  // Objektart it yields (v3: a field of the parent workflow; computed ones, the stage and geometry are left out),
  // searchable. The pick adds the form entry `<bind>.<property>` (A-047). Without any bind the list says so (v3
  // `builderRelatedPickerNoRelations`). A property that is in the form already shows greyed and cannot be picked.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Network from '@lucide/svelte/icons/network';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { MessageKey, Translate } from '../../shell/messages';
  import type { BoundTarget } from './bound';

  interface Props {
    open: boolean;
    t: Translate;
    targets: readonly BoundTarget[];
    onpick: (bind: string, property: string) => void;
  }
  let { open = $bindable(false), t, targets, onpick }: Props = $props();

  let chosen: string | undefined = $state();
  let search = $state('');

  const target = $derived(targets.find((x) => x.name === chosen));
  const candidates = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return (target?.properties ?? []).filter((p) => q === '' || p.label.toLowerCase().includes(q));
  });

  $effect(() => {
    if (!open) {
      chosen = undefined;
      search = '';
    }
  });

  function pick(property: string): void {
    if (target === undefined) return;
    onpick(target.name, property);
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85dvh] overflow-hidden sm:max-w-md" data-testid="linked-picker">
    <Dialog.Header>
      <Dialog.Title>{t('form_linked_title')}</Dialog.Title>
      <Dialog.Description>
        {target === undefined
          ? t('form_linked_step_link')
          : t('form_linked_step_field', { objektart: target.typeLabel, link: target.name })}
      </Dialog.Description>
    </Dialog.Header>

    {#if target === undefined}
      <div class="list">
        {#if targets.length === 0}
          <p class="empty" data-testid="linked-none">{t('form_linked_none')}</p>
        {:else}
          {#each targets as x (x.name)}
            <button
              type="button"
              class="row"
              data-testid={`linked-bind-${x.name}`}
              onclick={() => (chosen = x.name)}
            >
              <Network size={16} class="muted" />
              <span class="grow">{x.name} <span class="muted">({x.typeLabel})</span></span>
              <ArrowRight size={16} class="muted" />
            </button>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="step">
        <button type="button" class="back" data-testid="linked-back" onclick={() => (chosen = undefined)}>
          <ArrowLeft size={14} />
          {t('form_linked_back')}
        </button>
        <Input
          bind:value={search}
          placeholder={t('form_linked_search')}
          aria-label={t('form_linked_search')}
        />
        <div class="list">
          {#if candidates.length === 0}
            <p class="empty">{t('form_linked_no_fields')}</p>
          {:else}
            {#each candidates as p (p.key)}
              <button
                type="button"
                class="row"
                disabled={p.used}
                title={p.used ? t('form_linked_in_form') : undefined}
                data-testid={`linked-field-${p.key}`}
                onclick={() => pick(p.key)}
              >
                <span class="grow">{p.label}</span>
                <span class="muted small">{t(`field_type_${p.property.type}` as MessageKey)}</span>
              </button>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 50dvh;
    padding: 0.25rem 0;
    overflow-y: auto;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.5rem 0.625rem;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    transition: all 0.12s ease;
  }
  .row:hover:not(:disabled) {
    background: var(--accent);
    border-color: color-mix(in oklab, var(--primary) 40%, transparent);
  }
  .row:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted,
  .row :global(.muted) {
    color: var(--muted-foreground);
  }
  .small {
    font-size: 0.75rem;
  }
  .empty {
    padding: 1.5rem 0.5rem;
    margin: 0;
    font-size: 0.875rem;
    text-align: center;
    color: var(--muted-foreground);
  }
  .back {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 0.25rem;
    min-height: 2rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    cursor: pointer;
    background: none;
    border: none;
  }
  .back:hover {
    color: var(--foreground);
  }
</style>
