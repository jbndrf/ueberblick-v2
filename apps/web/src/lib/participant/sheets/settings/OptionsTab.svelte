<script lang="ts">
  // Optionen (v3 `SettingsSheet.svelte:556-563`): theme, font size, language, and the box of tool switches
  // (`tools/ToolSwitches.svelte`, v3 `AdvancedFeaturesPanel`), which brings its own title; nothing here knows a role (H3).
  import type { Snippet } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import ALargeSmall from '@lucide/svelte/icons/a-large-small';
  import Languages from '@lucide/svelte/icons/languages';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import { message, type Locale } from '../../messages';
  import { FONT_SIZES, THEME_MODES, type UiPrefs } from './prefs';

  interface Props {
    prefs: UiPrefs;
    locale: Locale;
    onchange: (patch: Partial<UiPrefs>) => void;
    tools?: Snippet | undefined;
  }
  let { prefs, locale, onchange, tools }: Props = $props();

  const themeText = { light: 'settings_theme_light', dark: 'settings_theme_dark' } as const;
  const sizeText = {
    xs: 'settings_size_xs',
    small: 'settings_size_s',
    medium: 'settings_size_m',
    large: 'settings_size_l',
    xl: 'settings_size_xl',
  } as const;
  // v3 offers EN first, then DE (`language-selector-inline.svelte:25-38`).
  const localeOrder = ['en', 'de'] as const;
  const localeText = { de: 'settings_language_de', en: 'settings_language_en' } as const;
</script>

<div class="space-y-4">
  <div
    class="flex items-center justify-between gap-2"
    role="group"
    aria-label={message(locale, 'settings_theme')}
  >
    <div class="flex items-center gap-2 text-sm">
      {#if prefs.theme === 'dark'}<Moon class="h-4 w-4" />{:else}<Sun class="h-4 w-4" />{/if}
      <span>{message(locale, 'settings_theme')}</span>
    </div>
    <div class="flex gap-1">
      {#each THEME_MODES.keys as key (key)}
        <Button
          variant={prefs.theme === key ? 'default' : 'outline'}
          size="sm"
          aria-pressed={prefs.theme === key}
          onclick={() => onchange({ theme: key })}
        >
          {#if key === 'dark'}<Moon class="h-3 w-3" />{:else}<Sun class="h-3 w-3" />{/if}
          {message(locale, themeText[key])}
        </Button>
      {/each}
    </div>
  </div>

  <div
    class="flex items-center justify-between gap-2"
    role="group"
    aria-label={message(locale, 'settings_font_size')}
  >
    <div class="flex items-center gap-2 text-sm">
      <ALargeSmall class="h-4 w-4" />
      <span>{message(locale, 'settings_font_size')}</span>
    </div>
    <div class="flex gap-1">
      {#each FONT_SIZES.keys as key (key)}
        <Button
          variant={prefs.fontSize === key ? 'default' : 'outline'}
          size="sm"
          class="px-2"
          aria-pressed={prefs.fontSize === key}
          onclick={() => onchange({ fontSize: key })}
        >
          {message(locale, sizeText[key])}
        </Button>
      {/each}
    </div>
  </div>

  <div
    class="flex items-center justify-between gap-2"
    role="group"
    aria-label={message(locale, 'settings_language')}
  >
    <div class="flex items-center gap-2 text-sm">
      <Languages class="h-4 w-4" />
      <span>{message(locale, 'settings_language')}</span>
    </div>
    <div class="flex gap-1">
      {#each localeOrder as key (key)}
        <Button
          variant={prefs.locale === key ? 'default' : 'outline'}
          size="sm"
          aria-pressed={prefs.locale === key}
          onclick={() => onchange({ locale: key })}
        >
          {message(locale, localeText[key])}
        </Button>
      {/each}
    </div>
  </div>

  {@render tools?.()}
</div>
