<script lang="ts">
  // The account menu (v3 `+layout.svelte:603-645`): e-mail, theme, language, Abmelden. v3's "Einstellungen" opened the
  // participant page `/settings`, which sends admins back (register a1, bug 4), so it is not here.
  import Check from '@lucide/svelte/icons/check';
  import Languages from '@lucide/svelte/icons/languages';
  import LogOut from '@lucide/svelte/icons/log-out';
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import UserCircle from '@lucide/svelte/icons/user-circle';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { adminMessage, type AdminKey } from './messages';
  import type { Locale } from './locale';

  export type Theme = 'light' | 'dark';

  let {
    locale,
    email,
    theme,
    onTheme,
    onLocale,
    onSignOut,
  }: {
    locale: Locale;
    email: string;
    theme: Theme;
    onTheme: (theme: Theme) => void;
    onLocale: (locale: Locale) => void;
    onSignOut: () => void;
  } = $props();

  const t = (key: AdminKey): string => adminMessage(locale, key);
  const THEMES: readonly (readonly [Theme, AdminKey])[] = [
    ['light', 'theme_light'],
    ['dark', 'theme_dark'],
  ];
  const LOCALES: readonly (readonly [Locale, AdminKey])[] = [
    ['en', 'language_en'],
    ['de', 'language_de'],
  ];
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" class="h-9 w-9">
        <UserCircle class="h-5 w-5" />
        <span class="sr-only">{t('account')}</span>
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-56">
    <DropdownMenu.Label>
      <div class="flex flex-col space-y-1">
        <p class="text-sm leading-none font-medium">{t('account')}</p>
        <p class="text-xs leading-none text-muted-foreground">{email}</p>
      </div>
    </DropdownMenu.Label>
    <DropdownMenu.Separator />

    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        {#if theme === 'dark'}<Moon class="mr-2 h-4 w-4" />{:else}<Sun class="mr-2 h-4 w-4" />{/if}
        <span>{t('theme')}</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>
        {#each THEMES as [value, label] (value)}
          <DropdownMenu.Item onclick={() => onTheme(value)}>
            {#if value === 'dark'}<Moon class="mr-2 h-4 w-4" />{:else}<Sun class="mr-2 h-4 w-4" />{/if}
            <span>{t(label)}</span>
            {#if theme === value}<Check class="ml-auto h-4 w-4" />{/if}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>

    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <Languages class="mr-2 h-4 w-4" />
        <span>{t('language')}</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>
        {#each LOCALES as [value, label] (value)}
          <DropdownMenu.Item onclick={() => onLocale(value)}>
            <span>{t(label)}</span>
            {#if locale === value}<Check class="ml-auto h-4 w-4" />{/if}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>

    <DropdownMenu.Separator />
    <DropdownMenu.Item onclick={onSignOut}>
      <LogOut class="mr-2 h-4 w-4" />
      {t('sign_out')}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
