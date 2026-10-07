<script lang="ts">
  // Register Q7 a: the second tab of the Code view, "Anpassungen": the raw overlay entries of this Objektart
  // (what the project changed against the template), read-only, with Kopieren. The text is read from the
  // Doc's own overlay (`overlayYaml`), so an edit in any view shows up here at once.
  import Check from '@lucide/svelte/icons/check';
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { BuilderContext } from '../shell/context';
  import { copyText } from '../shared/clipboard';

  interface Props {
    ctx: BuilderContext;
    /** The overlay text of the Objektart; `''` when the project changed nothing there. */
    text: string;
  }
  let { ctx, text }: Props = $props();

  const t = $derived(ctx.t);
  let copied = $state(false);

  async function copy(): Promise<void> {
    if (!(await copyText(text))) return;
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="panel" data-testid="code-overlay">
  <div class="bar">
    <p class="hint">{t('code_overlay_hint')}</p>
    {#if text !== ''}
      <Button variant="ghost" size="sm" onclick={copy} data-testid="overlay-copy">
        {#if copied}<Check />{:else}<ClipboardCopy />{/if}
        {copied ? t('code_copied') : t('code_copy')}
      </Button>
    {/if}
  </div>
  {#if text === ''}
    <p class="empty" data-testid="overlay-empty">{t('code_overlay_empty')}</p>
  {:else}
    <textarea
      class="code"
      readonly
      spellcheck="false"
      aria-label={t('code_overlay_label')}
      data-testid="overlay-text"
      value={text}
    ></textarea>
  {/if}
</div>

<style>
  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    min-width: 0;
    min-height: 0;
    padding: 0.75rem 1rem;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .hint {
    margin: 0;
    max-width: 60ch;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .empty {
    margin: 0;
    font-size: 0.8125rem;
    font-style: italic;
    color: var(--muted-foreground);
  }
  .code {
    flex: 1;
    width: 100%;
    min-height: 12rem;
    padding: 0.5rem;
    font:
      0.75rem/1.5 ui-monospace,
      monospace;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    resize: none;
  }
  .panel :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  @media (max-width: 767px) {
    .panel {
      padding: 0.5rem;
    }
  }
</style>
