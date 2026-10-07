<script lang="ts">
  // v3 `form-editor/SmartDropdownMappingModal.svelte`: one tab per value of the Quellfeld (a dot marks a tab that has
  // options), and on the tab "Optionen wenn „x“ ausgewählt ist". v3 typed the options into a textarea per tab, one
  // per line with "Antwort, Erklärungstext"; here the options are the field's own (one list for every tab, so a
  // spelling cannot differ between tabs) and a tab is a checklist of them. The explanation text shows under the
  // option and is edited in the Felddefinition; a new option can still be added here, as v3's textarea allowed, and
  // is offered for the tab that is open. Every tick is written at once; "Fertig" closes.
  import Plus from '@lucide/svelte/icons/plus';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { Translate } from '../../shell/messages';
  import type { ChoiceBranch, SourceOption } from './choice';

  interface Props {
    open: boolean;
    t: Translate;
    sourceLabel: string;
    /** The values of the Quellfeld: one tab each. */
    tabs: readonly SourceOption[];
    /** The options of this field: the checklist. */
    options: readonly SourceOption[];
    branches: readonly ChoiceBranch[];
    ontoggle: (when: string, option: string, on: boolean) => void;
    onadd: (label: string, when: string) => void;
  }
  let { open = $bindable(false), t, sourceLabel, tabs, options, branches, ontoggle, onadd }: Props = $props();

  let picked = $state('');
  let draft = $state('');
  const active = $derived(tabs.some((x) => x.key === picked) ? picked : (tabs[0]?.key ?? ''));
  const activeLabel = $derived(tabs.find((x) => x.key === active)?.label ?? '');
  const offered = (when: string): ReadonlySet<string> =>
    new Set(branches.find((b) => b.when === when)?.options ?? []);
  const has = (when: string): boolean => offered(when).size > 0;
  const on = $derived(offered(active));

  function add(): void {
    const text = draft.trim();
    if (text === '' || active === '') return;
    onadd(text, active);
    draft = '';
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="smart-modal sm:max-w-[640px]" data-testid="smart-modal">
    <Dialog.Header>
      <Dialog.Title>{t('form_smart_map_title')}</Dialog.Title>
      <Dialog.Description>
        {t('form_smart_map_source')}
        <strong>{sourceLabel}</strong>
      </Dialog.Description>
    </Dialog.Header>

    {#if tabs.length > 0}
      <div class="body">
        <div class="tabs" role="tablist" aria-label={sourceLabel}>
          {#each tabs as tab (tab.key)}
            <button
              type="button"
              role="tab"
              class="tab"
              class:active={active === tab.key}
              aria-selected={active === tab.key}
              data-testid={`smart-tab-${tab.key}`}
              onclick={() => (picked = tab.key)}
            >
              {tab.label}
              {#if has(tab.key)}<span class="dot" data-testid={`smart-dot-${tab.key}`}></span>{/if}
            </button>
          {/each}
        </div>

        <div class="content" role="tabpanel" data-testid="smart-panel" data-when={active}>
          <span class="lbl">{t('form_smart_map_options', { label: activeLabel })}</span>
          {#if options.length === 0}
            <p class="none">{t('form_smart_map_empty')}</p>
          {:else}
            <ul class="list">
              {#each options as option (option.key)}
                <li class="row">
                  <Checkbox
                    id={`smart-opt-${option.key}`}
                    checked={on.has(option.key)}
                    onCheckedChange={(v: boolean) => ontoggle(active, option.key, v)}
                    data-testid={`smart-option-${option.key}`}
                  />
                  <label class="opt" for={`smart-opt-${option.key}`}>
                    <span class="name">{option.label}</span>
                    {#if option.hint !== ''}<span class="why">{option.hint}</span>{/if}
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="add">
            <Input
              bind:value={draft}
              placeholder={t('form_smart_map_new')}
              aria-label={t('form_smart_map_add')}
              data-testid="smart-option-new"
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button
              variant="outline"
              size="icon"
              onclick={add}
              disabled={draft.trim() === ''}
              aria-label={t('form_smart_map_add')}
              data-testid="smart-option-add"
            >
              <Plus />
            </Button>
          </div>
          <p class="hint">{t('form_smart_map_hint')}</p>
        </div>
      </div>
    {:else}
      <p class="empty">{t('form_smart_map_none')}</p>
    {/if}

    <Dialog.Footer>
      <Button onclick={() => (open = false)} data-testid="smart-done">{t('form_smart_map_done')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .body {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }
  .tabs {
    display: flex;
    overflow-x: auto;
    background: color-mix(in oklab, var(--muted) 50%, transparent);
    border-bottom: 1px solid var(--border);
  }
  .tab {
    position: relative;
    flex-shrink: 0;
    min-height: 2.75rem;
    padding: 0.625rem 1rem;
    margin-bottom: -1px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--muted-foreground);
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    transition: all 0.15s ease;
  }
  .tab:hover {
    color: var(--foreground);
    background: var(--muted);
  }
  .tab.active {
    color: var(--primary);
    background: var(--background);
    border-bottom-color: var(--primary);
  }
  .dot {
    position: absolute;
    top: 0.5rem;
    right: 0.375rem;
    width: 6px;
    height: 6px;
    background: var(--primary);
    border-radius: 50%;
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: min(420px, 50dvh);
    padding: 1rem;
    overflow-y: auto;
    background: var(--background);
  }
  .lbl {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .list {
    display: flex;
    flex-direction: column;
    padding: 0;
    margin: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    min-height: 2.75rem;
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .row:last-child {
    border-bottom: none;
  }
  .opt {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    cursor: pointer;
  }
  .name {
    font-size: 0.875rem;
  }
  .why {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .add {
    display: flex;
    gap: 0.375rem;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .none,
  .empty {
    margin: 0;
    font-size: 0.875rem;
    font-style: italic;
    color: var(--muted-foreground);
  }
  .empty {
    padding: 1rem;
    text-align: center;
  }
</style>
