<script lang="ts">
  // "Aus Datei importieren" with problems: v3 showed one toast ("Projekt konnte nicht importiert werden",
  // `+page.svelte:114-122`) and nothing else. The server checks the file as a deploy would (shape, template, rules), so
  // the dialog lists every problem with its place in the file, and says that no project was created.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { FileProblem } from './menu-client';

  let {
    open = $bindable(false),
    locale,
    fileName,
    problems,
  }: {
    open?: boolean;
    locale: Locale;
    fileName: string;
    problems: readonly FileProblem[];
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('projects_import_problems_title')}</Dialog.Title>
      <Dialog.Description>{fileName} · {t('projects_import_problems_hint')}</Dialog.Description>
    </Dialog.Header>
    <ul class="max-h-72 space-y-2 overflow-y-auto py-2 text-sm" data-testid="import-problems">
      {#each problems as problem, i (i)}
        <li class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          {#if problem.path}<code class="mr-2 text-xs font-semibold">{problem.path}</code>{/if}
          <span>{problem.message}</span>
        </li>
      {/each}
    </ul>
    <Dialog.Footer>
      <Button onclick={() => (open = false)}>{t('projects_close')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
