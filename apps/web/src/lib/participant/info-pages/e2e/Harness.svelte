<script lang="ts">
  // Profil's participant card and page lists with the real info-page dialog. Test fixture only.
  import ProfileTab from '../../sheets/settings/ProfileTab.svelte';
  import InfoPageDialog from '../InfoPageDialog.svelte';
  import { infoEntries, legalEntries, type PageEntry } from '../pages';

  const login = { token: 'tok-4711', link: 'https://example.org/login/tok-4711' };
  const identity = {
    infoPages: [
      {
        key: 'hilfe',
        title: { de: 'Hilfe', en: 'Help' },
        content: { de: '<h2>So geht es</h2><p>Dein Token: $token</p>', en: '' },
      },
      {
        key: 'zweit',
        title: { de: 'Zweites Handy', en: 'Second phone' },
        content: { de: '<p>Scanne:</p>$qrloginlink<p>Link: $loginlink</p>$qrtoken', en: '' },
      },
    ],
    legalPages: [{ slug: 'impressum', title: 'Impressum', body: '<p>Betreiber Beispiel</p>' }],
  };
  let open = $state(false);
  let page: PageEntry | undefined = $state();
  const noop = (): void => undefined;
</script>

<div class="mx-auto w-full max-w-sm p-4">
  <ProfileTab
    locale="de"
    roleLabel={(k) => k}
    participant={{ id: 'anna', name: 'Anna Beispiel', roles: ['pruefer'], email: 'anna@example.org' }}
    infoPages={infoEntries(identity, 'de')}
    legalPages={legalEntries(identity)}
    online={true}
    syncing={false}
    freshness={{ ago: 'vor 5 Minuten', staleDays: undefined }}
    hasSynced={true}
    syncError={undefined}
    rows={[]}
    onsyncnow={noop}
    onjump={noop}
    onresend={noop}
    ondiscard={noop}
    onsignout={async () => true}
    onpage={(entry) => {
      page = entry;
      open = true;
    }}
  />
</div>
<InfoPageDialog bind:open locale="de" {page} {login} />
