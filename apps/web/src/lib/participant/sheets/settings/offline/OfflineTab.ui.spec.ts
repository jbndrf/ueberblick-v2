// @vitest-environment jsdom
// WP-650: the Offline tab replays v3's journey (SettingsSheet.svelte:556-870, package-selector.svelte,
// map/+page.svelte:2791): install card, Kartenkacheln with the pack selector, Speicher, the download card above the bar.
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import DownloadCard from '../../../offline/DownloadCard.svelte';
import { fakeOffline } from '../../../offline/fake.testing';
import OfflineTab from './OfflineTab.svelte';

afterEach(cleanup);

function mount(over: Parameters<typeof fakeOffline>[0] = {}, records = 42, locale: 'de' | 'en' = 'de') {
  const fake = fakeOffline(over);
  const view = render(OfflineTab, { props: { context: fake.context, locale, records } });
  return { ...fake, ...view };
}

/** Holds the next downloads until `release()`, so the card and the rows can be seen mid-flight. */
function hold(fake: ReturnType<typeof fakeOffline>) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const real = fake.server.download.bind(fake.server);
  fake.server.download = async (url, from, signal) => {
    await gate;
    return real(url, from, signal);
  };
  return release;
}

describe('install card (v3 :559-651)', () => {
  it('in the browser: "Läuft im Browser", the button waits for the install prompt, then asks it', async () => {
    const { fire } = mount();
    expect(screen.getByText('Läuft im Browser')).toBeTruthy();
    const button = screen.getByRole('button', { name: /Installieren/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Nur so lässt sich die App ohne Internetverbindung starten/)).toBeTruthy();
    const prompt = vi.fn(async () => undefined);
    fire('beforeinstallprompt', {
      preventDefault: () => undefined,
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    await userEvent.setup().click(button);
    expect(prompt).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('App installiert')).toBeTruthy());
  });

  it('installed: green state, the standalone text and no install button', () => {
    mount({ standalone: true });
    expect(screen.getByText('App installiert')).toBeTruthy();
    expect(screen.getByText(/vollständiger Offline-Unterstützung installiert/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Installieren/ })).toBeNull();
  });

  it('iOS, not installed: the steps Teilen → Zum Home-Bildschirm instead of a disabled button (WP-810)', () => {
    mount({ ios: true });
    expect(screen.getByText(/Zum Home-Bildschirm/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Installieren/ })).toBeNull();
  });

  it('iOS, installed: the installed state as before', () => {
    mount({ ios: true, standalone: true });
    expect(screen.getByText('App installiert')).toBeTruthy();
    expect(screen.queryByText(/Zum Home-Bildschirm/)).toBeNull();
  });

  it('the technical details name the service worker and the install prompt, in German', async () => {
    const { container } = mount();
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(within(details).getByText('Technische Details')).toBeTruthy();
    expect(within(details).getByText('Service Worker:')).toBeTruthy();
    await waitFor(() => expect(within(details).getByText('registriert')).toBeTruthy());
    expect(within(details).getByText('Installationsaufforderung:')).toBeTruthy();
    expect(within(details).getByText('nicht verfügbar')).toBeTruthy();
  });
});

describe('Kartenkacheln and the pack selector (v3 :653-761, package-selector.svelte)', () => {
  it('no pack yet: the orange hint and "Kacheln herunterladen" open the selector with the server\'s packs', async () => {
    mount();
    const user = userEvent.setup();
    expect(await screen.findByText(/Noch keine Kartenkacheln heruntergeladen/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Kacheln herunterladen' }));
    const dialog = await screen.findByTestId('package-dialog');
    expect(within(dialog).getByText('Offline-Pakete')).toBeTruthy();
    const row = await within(dialog).findByTestId('pack-row');
    expect(within(row).getByText('Innenstadt')).toBeTruthy();
    expect(within(row).getByText('Zoom: 12–17')).toBeTruthy();
    expect(within(row).getByText('1.200 Kacheln, 2,0 KB')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Schließen' })).toBeTruthy();
  });

  it('download: progress with received / total and a disabled Schließen, then the Heruntergeladen badge', async () => {
    const fake = mount();
    const release = hold(fake);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Kacheln herunterladen' }));
    const dialog = await screen.findByTestId('package-dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Herunterladen' }));
    await within(dialog).findByText('Wird heruntergeladen');
    expect(within(dialog).getByText(/Wird heruntergeladen\.\.\. 0 B \/ 2,0 KB/)).toBeTruthy();
    const close = within(dialog).getByRole('button', { name: 'Paket wird heruntergeladen...' });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    release();
    await within(dialog).findByText('Heruntergeladen');
    // the dialog stays busy while the copy goes to Downloads (v3), so the button comes back a moment after the badge
    expect(await within(dialog).findByRole('button', { name: 'Schließen' })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(screen.queryByTestId('package-dialog')).toBeNull());
  });

  it('a ready pack: name, date, tile count with size, Bereich ändern, and a two-step Löschen', async () => {
    const fake = mount();
    await fake.context.offline.manager.sync();
    const box = await screen.findByTestId('ready-pack');
    expect(within(box).getByText('Innenstadt')).toBeTruthy();
    expect(within(box).getByText(/2026/)).toBeTruthy();
    expect(within(box).getByText(/1\.200 Kacheln\s+\(2,0 KB\)/)).toBeTruthy();
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Bereich ändern' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(screen.getByRole('button', { name: 'Löschen bestätigen' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Löschen bestätigen' }));
    await screen.findByText(/Noch keine Kartenkacheln heruntergeladen/);
    expect([...fake.storage.files.keys()]).toEqual([]);
  });

  it('several packs: each has its own Löschen and one Bereich ändern serves all', async () => {
    const fake = mount({
      packs: [
        { key: 'a', label: 'Nord', layer: 'osm' },
        { key: 'b', label: 'Süd', layer: 'osm2' },
      ],
    });
    await fake.context.offline.manager.sync();
    await waitFor(() => expect(screen.getAllByTestId('ready-pack')).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'Löschen' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Bereich ändern' })).toHaveLength(1);
  });

  it('while a pack downloads the card shows the blue box with the sizes', async () => {
    const fake = mount();
    const release = hold(fake);
    await fake.context.offline.list();
    void fake.context.offline.manager.download(['innen']);
    const box = await screen.findByTestId('tiles-downloading');
    expect(within(box).getByText('Wird heruntergeladen...')).toBeTruthy();
    expect(within(box).getByText(/0 B \/ 2,0 KB/)).toBeTruthy();
    release();
    await screen.findByTestId('ready-pack');
  });

  it('the selector says when the list cannot be loaded, and Erneut versuchen loads it again', async () => {
    const fake = mount();
    fake.server.offline = true;
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Kacheln herunterladen' }));
    await screen.findByText('Pakete konnten nicht geladen werden');
    fake.server.offline = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByText('Innenstadt');
  });

  it('the selector says when the server offers no pack', async () => {
    mount({ packs: [] });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Kacheln herunterladen' }));
    expect(await screen.findByText('Keine Pakete verfügbar')).toBeTruthy();
    expect(screen.getByText('Bitte den Projektadmin, ein Offline-Paket zu erstellen')).toBeTruthy();
  });

  it('a failed download shows its reason in the row and offers the download again', async () => {
    const fake = mount();
    fake.server.cutAfter = 100;
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Kacheln herunterladen' }));
    await user.click(await screen.findByRole('button', { name: 'Herunterladen' }));
    expect(await screen.findByTestId('pack-failed')).toBeTruthy();
    expect(screen.getByTestId('pack-failed').textContent).toContain('Download fehlgeschlagen');
    expect(screen.getByRole('button', { name: 'Herunterladen' })).toBeTruthy();
  });

  it('a device without OPFS says so and offers no download', async () => {
    mount({ supported: false });
    expect(screen.getByTestId('tiles-unsupported').textContent).toContain('kann keine Kartenkacheln');
    expect(screen.queryByRole('button', { name: 'Kacheln herunterladen' })).toBeNull();
  });
});

describe('Speicher (v3 :817-870)', () => {
  it('shows usage of the quota with the share, the counts and persistent storage', async () => {
    const fake = mount({}, 42);
    await fake.context.offline.manager.sync();
    const section = await screen.findByTestId('storage-section');
    await waitFor(() => expect(within(section).getByTestId('count-tiles').textContent).toContain('1.200'));
    expect(within(section).getByText('512,0 MB von 2,0 GB')).toBeTruthy();
    expect(within(section).getByText('25,0%')).toBeTruthy();
    expect(within(section).getByTestId('count-records').textContent).toContain('42');
    expect(within(section).getByTestId('count-files').textContent).toContain('0'); // no thumbnails kept
    expect(within(section).getByTestId('persistent').textContent).toBe('Aktiviert');
  });

  it('colours the bar orange above 70 % and red above 90 %, and says when storage is not guaranteed', async () => {
    mount({
      storage: {
        persisted: async () => false,
        estimate: async () => ({ usage: 95, quota: 100 }),
      },
    });
    const bar = await screen.findByTestId('storage-bar');
    expect(bar.querySelector('[data-level]')?.getAttribute('data-level')).toBe('high');
    expect(screen.getByTestId('persistent').textContent).toBe('Nicht garantiert');
  });

  it('has no bar when the browser does not tell the quota', async () => {
    mount({ storage: { estimate: async () => undefined } });
    await screen.findByTestId('storage-section');
    expect(screen.queryByTestId('storage-bar')).toBeNull();
  });
});

const PHOTOS = ['a', 'b', 'c', 'd'].map((c) => c.repeat(64));

describe('Offline-Bilder (v3 :740-800) and the Dateien count', () => {
  it('off: the card names the switch and says that no photos show offline; nothing is stored', async () => {
    const fake = mount({ photos: PHOTOS });
    const card = screen.getByTestId('images-card');
    expect(within(card).getByText('Offline-Bilder')).toBeTruthy();
    const sw = within(card).getByRole('switch', { name: 'Offline-Bilder' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(within(card).getByTestId('images-desc').textContent).toContain(
      'werden offline keine Fotos angezeigt',
    );
    await fake.context.images.start();
    expect(await fake.thumbs.count()).toBe(0);
    expect(fake.thumbsAsked).toEqual([]);
  });

  it('on: spinner and progress while it downloads, then the green line; the thumbnails are on the device', async () => {
    const fake = mount({ photos: PHOTOS });
    fake.net.hold();
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Offline-Bilder' }));
    const busy = await screen.findByTestId('images-busy');
    expect(busy.textContent).toContain('Vorschaubilder werden heruntergeladen...');
    expect((screen.getByRole('switch', { name: 'Offline-Bilder' }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId('images-progress').textContent).toContain('(0/4)'));
    fake.net.release();
    const on = await screen.findByTestId('images-on');
    expect(on.textContent).toBe('Foto-Vorschauen sind für die Offline-Ansicht gespeichert.');
    expect(fake.pref.on).toBe(true);
    expect(await fake.thumbs.count()).toBe(4);
    // Dateien in Speicher matches the stored blobs
    const files = within(await screen.findByTestId('storage-section')).getByTestId('count-files');
    await waitFor(() => expect(files.textContent).toContain('4'));
  });

  it('off again: "Gespeicherte Bilder werden entfernt", then the cache and the Dateien count are empty', async () => {
    const fake = mount({ photos: PHOTOS });
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Offline-Bilder' }));
    await screen.findByTestId('images-on');
    await user.click(screen.getByRole('switch', { name: 'Offline-Bilder' }));
    await screen.findByTestId('images-desc');
    expect(fake.pref.on).toBe(false);
    expect(await fake.thumbs.count()).toBe(0);
    const files = within(screen.getByTestId('storage-section')).getByTestId('count-files');
    await waitFor(() => expect(files.textContent).toContain('0'));
  });

  it('the preference follows the person: switched on elsewhere, the new device shows it on and fills it', async () => {
    const fake = mount({ photos: PHOTOS, imagesOn: true });
    expect(screen.getByRole('switch', { name: 'Offline-Bilder' }).getAttribute('aria-checked')).toBe('true');
    await fake.context.images.start();
    expect(await fake.thumbs.count()).toBe(4);
  });

  it('offline with the switch on: nothing is fetched for display; the thumbnails come when the connection is back', async () => {
    const fake = mount({ photos: PHOTOS, imagesOn: true });
    fake.net.online = false;
    await fake.context.images.start();
    expect(fake.thumbsAsked).toEqual([]);
    fake.net.online = true;
    await fake.context.images.refresh();
    expect(fake.thumbsAsked).toHaveLength(4);
  });

  it('a device without IndexedDB does not offer the switch', () => {
    mount({ noThumbCache: true });
    expect(screen.queryByTestId('images-card')).toBeNull();
  });

  it('in English', () => {
    mount({}, 1, 'en');
    expect(screen.getByText('Offline Images')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Offline Images' })).toBeTruthy();
  });
});

describe('the download card above the bar (v3 map/+page.svelte:2791)', () => {
  it('appears while a pack downloads, at the v3 place, and goes when it is done', async () => {
    const fake = fakeOffline();
    const release = hold(fake);
    render(DownloadCard, { offline: fake.context.offline, locale: 'de' });
    expect(screen.queryByTestId('download-card')).toBeNull();
    await fake.context.offline.list();
    const run = fake.context.offline.manager.download(['innen']);
    const card = await screen.findByTestId('download-card');
    expect(card.className).toContain('fixed right-4 bottom-20 left-4');
    expect(card.className).toContain('md:left-auto md:w-80');
    expect(within(card).getByText('Offline-Daten werden heruntergeladen...')).toBeTruthy();
    release();
    await run;
    await waitFor(() => expect(screen.queryByTestId('download-card')).toBeNull());
  });
});

describe('in English', () => {
  it('every string has a translation', async () => {
    mount({}, 1, 'en');
    expect(screen.getByText('Running in browser')).toBeTruthy();
    expect(screen.getByText('Map tiles')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Download tiles' })).toBeTruthy();
  });
});

// a fragment of a sheet is no page: the landmark rule does not apply to it
const noRegion = async (el: Element) => (await axeViolations(el)).filter((v) => !v.startsWith('region'));

describe('a11y', () => {
  it('has no axe violations while Offline-Bilder downloads and when it is on', async () => {
    const fake = mount({ photos: PHOTOS });
    fake.net.hold();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Offline-Bilder' }));
    await screen.findByTestId('images-busy');
    expect(await noRegion(document.body)).toEqual([]);
    fake.net.release();
    await screen.findByTestId('images-on');
    expect(await noRegion(document.body)).toEqual([]);
  });

  it('has no axe violations with a pack, and with the selector open', async () => {
    const fake = mount();
    await fake.context.offline.manager.sync();
    await screen.findByTestId('ready-pack');
    expect(await noRegion(document.body)).toEqual([]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bereich ändern' }));
    await screen.findByTestId('package-dialog');
    expect(await noRegion(document.body)).toEqual([]);
  });
});
