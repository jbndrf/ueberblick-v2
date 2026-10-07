<script lang="ts">
  import { untrack } from 'svelte';
  // Engine-new (WP-448, register a3 row 103; v3 had no template inputs): the template the project builds on, its version,
  // and one field per input the template author offers (`TemplateFile.inputs`, e.g. a district name), typed by the
  // input's property type. One Speichern saves the changed values as overlay `inputs.<key>` Doc ops on the draft
  // (`template-doc.ts`), like every other section. A template without inputs shows the template and version only.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { MultiSelect } from '@ueberblick/ui/components/ui/multi-select';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';
  import type { TemplateInputView } from './types';
  import { datetimeToSave, instantToLocalInput } from '../datetime-input';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  const inputs = $derived(data.template.inputs);
  // The fields start from the saved values; after that they hold the person's edit (booleans stay booleans, the rest text).
  type Field = string | boolean | string[] | Record<string, string>;
  // localized_text: one text per project language (the admin's two page languages, as the branding name).
  const LANGUAGES = [
    { code: 'de', key: 'settings_template_lang_de' },
    { code: 'en', key: 'settings_template_lang_en' },
  ] as const;
  const textsOf = (v: unknown): Record<string, string> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {};
  const asField = (i: TemplateInputView): Field =>
    i.type === 'boolean'
      ? i.value === true
      : i.type === 'multiselect'
        ? Array.isArray(i.value)
          ? i.value.filter((v): v is string => typeof v === 'string')
          : []
        : i.type === 'localized_text'
          ? textsOf(i.value)
          : i.type === 'datetime'
            ? instantToLocalInput(i.value)
            : i.value === null || i.value === undefined
              ? ''
              : String(i.value);
  const form = $state<Record<string, Field>>(
    untrack(() => Object.fromEntries(data.template.inputs.map((i) => [i.key, asField(i)]))),
  );
  let saving = $state(false);
  let invalid = $state<string | null>(null);

  const NUMERIC = ['integer', 'number'];
  function valueOf(i: TemplateInputView): unknown {
    const v = form[i.key];
    // A datetime field holds local time; the saved value is an ISO instant (null: unreadable).
    if (i.type === 'datetime') return datetimeToSave(i.value, String(v));
    // localized_text saves the filled languages only (an emptied language leaves the text).
    if (i.type === 'localized_text')
      return Object.fromEntries(Object.entries(v as Record<string, string>).filter(([, t]) => t !== ''));
    // A number input binds a number (null while empty); the rest bind text.
    if (NUMERIC.includes(i.type))
      return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
    return v;
  }
  const valid = (i: TemplateInputView, v: unknown): boolean =>
    ((i.type !== 'datetime' || v !== null) && !NUMERIC.includes(i.type)) ||
    (typeof v === 'number' && Number.isFinite(v) && (i.type === 'number' || Number.isInteger(v)));

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const changed: Record<string, unknown> = {};
    invalid = null;
    for (const i of inputs.filter((x) => x.editable)) {
      const v = valueOf(i);
      if (!valid(i, v)) {
        invalid = i.key;
        return;
      }
      if (JSON.stringify(v) !== JSON.stringify(i.value)) changed[i.key] = v;
    }
    if (Object.keys(changed).length === 0) return void toast.success(t('settings_template_saved'));
    saving = true;
    const r = await api.saveTemplateInputs(changed);
    saving = false;
    if (!r.ok) return void toast.error(r.message || t('settings_template_save_error'));
    toast.success(t('settings_template_saved'));
    notifyDraftChanged();
    await reload();
  }
</script>

<SettingsSection name={t('settings_template_title')} description={t('settings_template_description')}>
  <dl
    class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-md border p-4 text-sm"
    data-testid="template-summary"
  >
    <dt class="text-muted-foreground">{t('settings_template_name_label')}</dt>
    <dd class="font-medium">{data.template.label}</dd>
    <dt class="text-muted-foreground">{t('settings_template_version_label')}</dt>
    <dd class="font-medium">{data.template.version}</dd>
  </dl>

  {#if inputs.length === 0}
    <p class="text-sm text-muted-foreground">{t('settings_template_none')}</p>
  {:else}
    <form class="flex flex-col gap-4" onsubmit={save}>
      <h3 class="text-base font-semibold">{t('settings_template_inputs_title')}</h3>
      {#each inputs as input (input.key)}
        {@const id = `template-input-${input.key}`}
        <div class="space-y-2">
          {#if input.type === 'boolean' && input.editable}
            <div class="flex items-center justify-between gap-4 rounded-md border p-4">
              <div class="flex flex-col">
                <span id={`${id}-label`} class="font-medium">{input.label}</span>
                {#if input.description}<span class="text-xs text-muted-foreground">{input.description}</span
                  >{/if}
              </div>
              <Switch bind:checked={form[input.key] as boolean} aria-labelledby={`${id}-label`} />
            </div>
          {:else}
            <Label for={id}>{input.label}</Label>
            {#if input.type === 'multiselect' && input.editable}
              <MultiSelect
                {id}
                disablePortal
                options={input.options.map((o) => ({ value: o.key, label: o.label }))}
                bind:selected={form[input.key] as string[]}
              />
            {:else if input.type === 'localized_text' && input.editable}
              {#each LANGUAGES as lang (lang.code)}
                <Input
                  id={`${id}-${lang.code}`}
                  name={`${id}-${lang.code}`}
                  aria-label={`${input.label} (${t(lang.key)})`}
                  placeholder={t(lang.key)}
                  bind:value={(form[input.key] as Record<string, string>)[lang.code]}
                />
              {/each}
            {:else if input.type === 'select' && input.editable}
              <select
                {id}
                bind:value={form[input.key] as string}
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {#each input.options as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
              </select>
            {:else}
              <Input
                {id}
                name={id}
                type={input.type === 'integer' || input.type === 'number'
                  ? 'number'
                  : input.type === 'date'
                    ? 'date'
                    : input.type === 'datetime'
                      ? 'datetime-local'
                      : input.type === 'time'
                        ? 'time'
                        : 'text'}
                step={input.type === 'integer' ? '1' : input.type === 'number' ? 'any' : undefined}
                disabled={!input.editable}
                bind:value={form[input.key] as string}
              />
            {/if}
            {#if input.description}<p class="text-xs text-muted-foreground">{input.description}</p>{/if}
          {/if}
          {#if !input.editable}
            <p class="text-xs text-muted-foreground">{t('settings_template_readonly')}</p>
          {/if}
          {#if invalid === input.key}
            <p class="text-xs text-destructive" role="alert">{t('settings_template_invalid')}</p>
          {/if}
        </div>
      {/each}
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? t('settings_saving') : t('settings_save')}
        </Button>
      </div>
    </form>
  {/if}
</SettingsSection>
