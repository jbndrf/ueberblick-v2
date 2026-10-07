<script lang="ts">
  // "Als Vorlage veröffentlichen" (Q11, S3-7): key, name and version of the new template version. Not in v3's menu (v3
  // had no templates); the dialog is the v3 dialog look (`Dialog`, Label + Input, Abbrechen / primary). The key starts
  // as the project's key, the name as its name, the version as the next one for that key (`suggestVersion`).
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { publishAsTemplate, suggestVersion, type PublishField } from './menu-client';

  interface Listing {
    readonly key: string;
    readonly version: string;
  }
  let {
    open = $bindable(false),
    locale,
    project,
    templates,
    onpublished,
  }: {
    open?: boolean;
    locale: Locale;
    project: { readonly key: string; readonly name: string };
    templates: readonly Listing[];
    onpublished: (key: string, version: string) => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const uid = $props.id();
  let key = $state(untrack(() => project.key));
  let label = $state(untrack(() => project.name));
  let version = $state(untrack(() => suggestVersion(templates, project.key)));
  let problems = $state<Partial<Record<PublishField, string>>>({});
  let failure = $state<string | null>(null);
  let working = $state(false);

  $effect(() => {
    if (open) {
      key = project.key;
      label = project.name;
      version = suggestVersion(templates, project.key);
      problems = {};
      failure = null;
    }
  });

  async function submit(): Promise<void> {
    if (working) return;
    if (label.trim() === '') {
      problems = { label: t('template_label_required') };
      return;
    }
    working = true;
    const r = await publishAsTemplate({ project: project.key, key, version, label });
    working = false;
    if (r.ok) {
      open = false;
      onpublished(r.key, r.version);
      return;
    }
    problems = r.fields;
    failure = Object.keys(r.fields).length > 0 ? null : (r.message ?? t('template_publish_failed'));
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('template_publish_title')}</Dialog.Title>
      <Dialog.Description>{t('template_publish_hint')}</Dialog.Description>
    </Dialog.Header>
    <form
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div class="grid gap-4 py-4">
        {#if failure}<p role="alert" class="text-sm text-destructive">{failure}</p>{/if}
        <div class="grid gap-2">
          <Label for="{uid}-label">{t('template_label')}</Label>
          <Input id="{uid}-label" bind:value={label} aria-invalid={problems.label ? 'true' : undefined} />
          {#if problems.label}<p class="text-sm text-destructive">{problems.label}</p>{/if}
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="{uid}-key">{t('template_key')}</Label>
            <Input id="{uid}-key" bind:value={key} aria-invalid={problems.key ? 'true' : undefined} />
            {#if problems.key}<p class="text-sm text-destructive">{t('template_key_invalid')}</p>{/if}
          </div>
          <div class="grid gap-2">
            <Label for="{uid}-version">{t('template_version')}</Label>
            <Input
              id="{uid}-version"
              bind:value={version}
              aria-invalid={problems.version ? 'true' : undefined}
            />
            {#if problems.version}<p class="text-sm text-destructive">{t('template_version_invalid')}</p>{/if}
          </div>
        </div>
      </div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('projects_cancel')}</Button>
        <Button type="submit" disabled={working}>{t('template_submit')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
