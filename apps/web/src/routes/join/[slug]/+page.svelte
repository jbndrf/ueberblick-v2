<script lang="ts">
  // The public self-join page (WP-639, WP-1074). Opening the link creates nothing: the guest is created by the POST of
  // this form (a link preview never submits it, v3 bug B12). The guest may type a name (optional, empty gives "Gast").
  import { onMount } from 'svelte';
  import * as Card from '@ueberblick/ui/components/ui/card';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import logo from '$lib/participant/login/logo-light.png';
  import { deviceLocale } from '$lib/participant/login/locale';
  import { message, type Locale } from '$lib/participant/messages';

  let { data }: { data: { slug: string; next: string } } = $props();

  let locale: Locale = $state('de');
  let working = $state(false);
  const action = $derived(
    `/join/${encodeURIComponent(data.slug)}/start?next=${encodeURIComponent(data.next)}`,
  );

  onMount(() => {
    locale = deviceLocale();
  });
</script>

<svelte:head><title>{message(locale, 'join_title')} - Überblick</title></svelte:head>

<div
  class="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900"
>
  <Card.Root class="w-full max-w-md">
    <Card.Header class="space-y-1 text-center">
      <img
        src={logo}
        alt={message(locale, 'join_logo_alt')}
        class="mx-auto mb-4 h-16 w-16 object-contain dark:invert"
      />
      <Card.Title class="text-2xl font-bold"><h1>{message(locale, 'join_title')}</h1></Card.Title>
      <Card.Description>{message(locale, 'join_subtitle')}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form
        method="POST"
        {action}
        class="space-y-4"
        data-testid="join-form"
        onsubmit={() => (working = true)}
      >
        <div class="space-y-2">
          <Label for="join-name">{message(locale, 'join_name_label')}</Label>
          <Input
            id="join-name"
            name="name"
            maxlength={40}
            autocomplete="nickname"
            placeholder={message(locale, 'join_name_placeholder')}
            data-testid="join-name"
          />
        </div>
        <Button type="submit" class="w-full" disabled={working}>
          {message(locale, working ? 'join_working' : 'join_submit')}
        </Button>
      </form>
    </Card.Content>
  </Card.Root>
</div>
