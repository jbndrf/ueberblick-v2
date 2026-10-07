<script lang="ts">
  // The admin sign-in card (v3 `login/+page.svelte:17-140`): logo, title, e-mail, password with a show/hide eye, an
  // error banner and one button, plus v3's "30 Tage angemeldet bleiben". v4 adds the one-time code, shown only with
  // `ADMIN_TOTP=on` (`totp`); an account without a confirmed code leaves it blank, is shown its QR code once and
  // confirms with the first code (WP-942).
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Card from '@ueberblick/ui/components/ui/card';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { adminMessage, type AdminKey } from '../shell/messages';
  import type { Locale } from '../shell/locale';
  import type { Credentials, SignInResult } from '../../../(builder)/admin-login';

  let {
    locale,
    totp: needsCode,
    rememberDays,
    submit,
    onsignedin,
    qr,
  }: {
    locale: Locale;
    /** `ADMIN_TOTP=on`: the one-time code field is shown. */
    totp: boolean;
    /** `SESSION_DAYS_ADMIN_REMEMBER`, named in the checkbox label. */
    rememberDays: number;
    submit: (credentials: Credentials) => Promise<SignInResult>;
    onsignedin: () => void;
    /** The enrolment QR code as an inline SVG. */
    qr: (otpauthUri: string) => Promise<string>;
  } = $props();

  const t = (key: AdminKey, values: Readonly<Record<string, string | number>> = {}): string =>
    adminMessage(locale, key, values);
  let email = $state('');
  let password = $state('');
  let totp = $state('');
  let remember = $state(false);
  let enrolUri = $state<string | null>(null);
  let enrolSvg = $state('');
  let showPassword = $state(false);
  let working = $state(false);
  let problem = $state<AdminKey | null>(null);
  let tried = $state(false);

  // v3's `loginSchema` (`lib/schemas/auth.ts`): a valid e-mail and a password of at least 6 characters.
  const emailError = $derived<AdminKey | null>(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'login_email_invalid',
  );
  const passwordError = $derived<AdminKey | null>(password.length >= 6 ? null : 'login_password_short');
  // Shown after the first submit, then follows the typing (superforms' "auto" validation).
  const shownEmail = $derived(tried ? emailError : null);
  const shownPassword = $derived(tried ? passwordError : null);

  async function onsubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    tried = true;
    if (emailError !== null || passwordError !== null) return;
    working = true;
    problem = null;
    const result = await submit({ email, password, totp: needsCode ? totp.trim() : '', remember });
    if (result.ok) {
      onsignedin();
      return;
    }
    working = false;
    problem = result.problem;
    totp = '';
    enrolUri = result.otpauthUri ?? null;
    enrolSvg = enrolUri === null ? '' : await qr(enrolUri);
  }

  const secretOf = (uri: string): string => new URL(uri).searchParams.get('secret') ?? '';
</script>

<Card.Root class="w-full max-w-md">
  <Card.Header class="space-y-1 text-center">
    <img
      src="/icons/logo-light.png"
      alt={t('product')}
      class="mx-auto mb-4 h-16 w-16 object-contain dark:invert"
    />
    <Card.Title class="text-2xl font-bold"><h1>{t('login_title')}</h1></Card.Title>
    <Card.Description>{t('login_subtitle')}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form {onsubmit} novalidate class="space-y-4">
      <div class="space-y-2">
        <Label for="email">{t('login_email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder={t('login_email_placeholder')}
          autocomplete="username"
          required
          bind:value={email}
          class={shownEmail ? 'border-destructive' : ''}
        />
        {#if shownEmail}<p class="text-sm text-destructive">{t(shownEmail)}</p>{/if}
      </div>

      <div class="space-y-2">
        <Label for="password">{t('login_password')}</Label>
        <div class="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            placeholder={t('login_password_placeholder')}
            autocomplete="current-password"
            required
            class={shownPassword ? 'border-destructive pr-10' : 'pr-10'}
            bind:value={password}
          />
          <button
            type="button"
            onclick={() => (showPassword = !showPassword)}
            class="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? t('login_hide_password') : t('login_show_password')}
          >
            {#if showPassword}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
          </button>
        </div>
        {#if shownPassword}<p class="text-sm text-destructive">{t(shownPassword)}</p>{/if}
      </div>

      {#if needsCode}
        <div class="space-y-2">
          <Label for="totp">{t('login_totp')}</Label>
          <Input
            id="totp"
            name="totp"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{'{6}'}"
            maxlength={6}
            aria-describedby="totp-hint"
            bind:value={totp}
          />
          <p id="totp-hint" class="text-xs text-muted-foreground">{t('login_totp_hint')}</p>
        </div>
      {/if}

      <div class="flex items-center gap-2">
        <Checkbox id="remember" name="remember" bind:checked={remember} />
        <Label for="remember" class="font-normal">{t('login_remember', { days: rememberDays })}</Label>
      </div>

      {#if enrolUri !== null}
        <figure class="m-0 grid justify-items-center gap-2">
          <div class="w-48 bg-white" role="img" aria-label={t('login_enrol_qr')}>{@html enrolSvg}</div>
          <figcaption class="text-sm break-all">
            {t('login_enrol_secret', { secret: secretOf(enrolUri) })}
          </figcaption>
        </figure>
      {/if}

      {#if problem !== null}
        <div
          role="alert"
          class="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-red-900 dark:text-red-100"
        >
          <AlertCircle class="h-4 w-4 shrink-0" />
          <span>{t(problem)}</span>
        </div>
      {/if}

      <Button type="submit" class="w-full" disabled={working}>
        {working ? t('login_working') : t('login_submit')}
      </Button>
    </form>
  </Card.Content>
</Card.Root>
