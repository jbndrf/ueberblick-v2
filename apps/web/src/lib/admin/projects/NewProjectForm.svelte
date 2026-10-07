<script lang="ts">
  // Projekt erstellen (v3 `admin/projects/new/+page.svelte`): title, subtitle, name, description, submit and cancel.
  // The template select is the one addition (Q10): "Leeres Projekt" comes first (the server lists it first).
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Card from '@ueberblick/ui/components/ui/card';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { templateRef, type FormProblems, type FormValues, type Problem } from './create-client';

  interface Listing {
    readonly key: string;
    readonly version: string;
    readonly label: { readonly de: string; readonly en: string };
  }
  let {
    locale,
    templates,
    values = $bindable(),
    problems,
    working = false,
    onsubmit,
  }: {
    locale: Locale;
    templates: readonly Listing[];
    values: FormValues;
    problems: FormProblems;
    working?: boolean;
    onsubmit: () => void;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(locale, key);
  const say = (p: Problem): string => ('key' in p ? t(p.key) : p.text);
</script>

<div class="container mx-auto max-w-2xl p-6">
  <div class="mb-6">
    <h1 class="text-3xl font-bold">{t('project_new_title')}</h1>
    <p class="text-muted-foreground">{t('project_new_subtitle')}</p>
  </div>

  <Card.Root>
    <Card.Content class="pt-6">
      <form
        novalidate
        onsubmit={(e) => {
          e.preventDefault();
          onsubmit();
        }}
      >
        <div class="space-y-4">
          {#if problems.form}
            <p role="alert" class="text-sm text-destructive">{say(problems.form)}</p>
          {/if}
          <div class="space-y-2">
            <Label for="name">{t('project_new_name')}</Label>
            <Input
              id="name"
              name="name"
              bind:value={values.name}
              placeholder={t('project_new_name_placeholder')}
              aria-invalid={problems.name ? 'true' : undefined}
            />
            {#if problems.name}<p class="text-sm text-destructive">{say(problems.name)}</p>{/if}
          </div>

          <div class="space-y-2">
            <Label for="description">{t('project_new_description')}</Label>
            <Textarea
              id="description"
              name="description"
              bind:value={values.description}
              placeholder={t('project_new_description_placeholder')}
              rows={4}
            />
            {#if problems.description}
              <p class="text-sm text-destructive">{say(problems.description)}</p>
            {/if}
          </div>

          <div class="space-y-2">
            <Label for="template">{t('project_new_template')}</Label>
            <select
              id="template"
              name="template"
              bind:value={values.template}
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
              aria-invalid={problems.template ? 'true' : undefined}
            >
              {#each templates as template (template.key)}
                <option value={templateRef(template)}>{template.label[locale]}</option>
              {/each}
            </select>
            {#if problems.template}
              <p class="text-sm text-destructive">{say(problems.template)}</p>
            {/if}
          </div>

          <div class="flex gap-4">
            <Button type="submit" disabled={working}>{t('project_new_submit')}</Button>
            <Button type="button" variant="outline" href="/admin/projects">{t('project_new_cancel')}</Button>
          </div>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
</div>
