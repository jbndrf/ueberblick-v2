<script lang="ts">
  // A page that draws the two kinds of choice field through FieldInput, as a form does. Test fixture only.
  import FieldInput from '../../../../form/FieldInput.svelte';
  import type { FormField, Json } from '../../../../form/contract';

  const options = {
    eiche: 'Eiche',
    buche: 'Buche',
    ahorn: 'Ahorn',
    linde: 'Linde',
    birke: 'Birke',
    kiefer: 'Kiefer',
    fichte: 'Fichte',
    erle: 'Erle',
    esche: 'Esche',
    ulme: 'Ulme',
  };
  const field = (key: string, input: 'select' | 'multiselect', label: string): FormField => ({
    key,
    id: key,
    type: input,
    input,
    label,
    appearance: [],
    options,
    integer: false,
  });
  let values = $state<Record<string, Json>>({});
</script>

<div class="mx-auto max-w-md space-y-4 p-4">
  <FieldInput
    field={field('art', 'select', 'Art')}
    value={values['art']}
    locale="de"
    required={false}
    readonly={false}
    onchange={(v) => (values['art'] = v)}
  />
  <FieldInput
    field={field('mix', 'multiselect', 'Mischung')}
    value={values['mix']}
    locale="de"
    required={false}
    readonly={false}
    onchange={(v) => (values['mix'] = v)}
  />
  <pre data-testid="values">{JSON.stringify(values)}</pre>
  <div class="h-[900px]"></div>
  <FieldInput
    field={field('unten', 'select', 'Unten')}
    value={values['unten']}
    locale="de"
    required={false}
    readonly={false}
    onchange={(v) => (values['unten'] = v)}
  />
</div>
