<script lang="ts">
  // v3's top-right controls on the login page (`login/+page.svelte:51-55`): language dropdown and theme button.
  import Languages from '@lucide/svelte/icons/languages';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { adminMessage } from '../shell/messages';
  import type { Locale } from '../shell/locale';
  import type { Theme } from '../shell/AccountMenu.svelte';

  let {
    locale,
    theme,
    onTheme,
    onLocale,
  }: {
    locale: Locale;
    theme: Theme;
    onTheme: (theme: Theme) => void;
    onLocale: (locale: Locale) => void;
  } = $props();
</script>

<div class="fixed top-4 right-4 flex items-center gap-2">
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="outline" size="sm" class="gap-2">
          <Languages class="h-4 w-4" />
          {adminMessage(locale, locale === 'de' ? 'language_de' : 'language_en')}
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-36">
      <DropdownMenu.RadioGroup value={locale} onValueChange={(v) => onLocale(v === 'de' ? 'de' : 'en')}>
        {#each [['en', 'language_en'], ['de', 'language_de']] as const as [value, label] (value)}
          <DropdownMenu.RadioItem {value}>{adminMessage(locale, label)}</DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
  <Button
    variant="outline"
    size="icon"
    onclick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
    aria-label={adminMessage(locale, theme === 'dark' ? 'theme_to_light' : 'theme_to_dark')}
  >
    {#if theme === 'dark'}<Sun class="h-5 w-5" />{:else}<Moon class="h-5 w-5" />{/if}
  </Button>
</div>
