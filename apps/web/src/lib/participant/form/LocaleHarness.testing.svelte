<script lang="ts">
  // Test harness (WP-790): the parent switches the language and nothing else changes, as MapScreen does.
  import type { ComponentProps } from 'svelte';
  import FormSheet from './FormSheet.svelte';

  type Props = Omit<ComponentProps<typeof FormSheet>, 'locale'> & {
    first: ComponentProps<typeof FormSheet>['locale'];
  };
  const { first, ...rest }: Props = $props();
  // svelte-ignore state_referenced_locally: the opening language
  let locale = $state(first);
  export function switchTo(next: Props['first']): void {
    locale = next;
  }
</script>

<FormSheet {...rest} {locale} />
