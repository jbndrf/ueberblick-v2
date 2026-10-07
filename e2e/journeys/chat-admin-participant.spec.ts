import { expect, test, type Browser, type Page } from '@playwright/test';
import { createAuth, importParticipant, openControlDb, openProjectDb } from '@ueberblick/server';
import { JOURNEYS_DATA_DIR } from './playwright.config';
import { publish } from '../../apps/web/e2e/support/publish';
import { PROJECT, adminSignIn, issueToken, qrLink, seedJourneyWorld } from './lib/world';

/**
 * WP-413: the Projekt-Chat across lanes. The admin switches it on for one role (WP-391, Projekteinstellungen,
 * Funktionen, Chat), publishes; a participant of that role finds the chat under Werkzeuge and posts (WP-684); a
 * participant of another role does not see it; switched off and published, the tile is gone after a reload.
 * Not part of the v3 journey catalogue (no id in docs/process/v3-journeys.md): it proves two lanes meet.
 * Runs at phone (390x844) and desktop (1280x800) through the suite's projects.
 */
const OTHER = 'participant-bauhof';
const SECTION = `/admin/projects/${PROJECT}/settings?section=chat`;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
  const db = openProjectDb(JOURNEYS_DATA_DIR, PROJECT);
  try {
    // an id that is on the roster already answers `participant_exists`: either way the second role is there
    importParticipant({ db, now: () => new Date() }, { id: OTHER, name: 'Bernd', roles: ['bauhof'] });
  } finally {
    db.close();
  }
});

/** True while the chat is on (or may be) in the published config: the cleanup below must then reset it. */
let chatMayBeOn = false;

/**
 * A failure mid-journey must not leave `musterstadt` with the chat in the draft or published for the specs that
 * follow. The admin settings read the draft, so the reset goes the way the journey does: switch the chat off, save,
 * and publish when the publish bar shows a pending change. Only when this spec switched it on.
 */
test.afterAll(async ({ browser, baseURL }) => {
  if (!chatMayBeOn) return;
  const context = await browser.newContext({ baseURL, locale: 'de-DE' });
  try {
    const page = await context.newPage();
    await adminSignIn(page);
    await page.goto(SECTION);
    const chatSwitch = page.getByRole('switch', { name: 'Projekt-Chat aktivieren' });
    await expect(chatSwitch).toBeVisible();
    if (await chatSwitch.isChecked()) {
      await chatSwitch.click();
      await saveChat(page);
    }
    const bar = page.getByTestId('publish-bar');
    if (await bar.isVisible()) await publish(page, { via: 'bar' });
    chatMayBeOn = false;
  } finally {
    await context.close();
  }
});

function tokenOfOther(): string {
  const control = openControlDb(`${JOURNEYS_DATA_DIR}/control.db`);
  try {
    const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
    return auth.issueCredential(`id-${PROJECT}`, OTHER).token;
  } finally {
    control.close();
  }
}

/**
 * Leaves exactly `label` selected in the role picker, whatever it shows on opening. A role without its own `app.tools`
 * (one the specs before this one created, e.g. AP-04) has the chat once it is on, so the picker may come up with that
 * role already ticked instead of empty ("Leer = alle"). The picker is a dropdown on desktop and a full-screen dialog on
 * a phone (as settings-chat.spec).
 */
async function selectOnlyRole(page: Page, label: string): Promise<void> {
  await page.locator('#chat-roles').click();
  const phone = page.getByRole('dialog', { name: /Optionen auswählen|Select options/ });
  const isPhone = await phone.isVisible();
  const items = isPhone ? phone.getByRole('checkbox') : page.getByRole('option');
  await expect(items.first()).toBeVisible();
  for (let i = 0; i < (await items.count()); i++) {
    const item = items.nth(i);
    const ticked = isPhone ? await item.isChecked() : (await item.getAttribute('aria-selected')) === 'true';
    const wanted = (await item.innerText()).includes(label);
    if (ticked !== wanted) await item.click();
  }
  if (isPhone) await phone.getByRole('button', { name: /^(Fertig|Done)/ }).click();
  else await page.keyboard.press('Escape');
}

async function saveChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Chat-Einstellungen gespeichert')).toBeVisible();
}

/** A participant device: an empty browser context signed in by the QR link of `token`. */
async function device(browser: Browser, baseURL: string, token: string) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    locale: 'de-DE',
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  const page = await context.newPage();
  await page.goto(qrLink(token));
  await expect(page).not.toHaveURL(/\/login/);
  return { context, page };
}

const toolsButton = (page: Page) => page.getByRole('button', { name: 'Werkzeuge', exact: true });
const chatTile = (page: Page) =>
  page.getByRole('dialog', { name: 'Werkzeuge', exact: true }).getByRole('button', { name: /Projekt-Chat/ });

test('journey: admin switches the chat on for one role; that role chats, another does not; off removes it', async ({
  page,
  browser,
  baseURL,
}) => {
  const origin = baseURL ?? '';

  // 1 + 2: the admin switches the chat on for Baumkontrolle only and publishes.
  await adminSignIn(page);
  await page.goto(SECTION);
  const chatSwitch = page.getByRole('switch', { name: 'Projekt-Chat aktivieren' });
  await expect(chatSwitch).not.toBeChecked();
  chatMayBeOn = true;
  await chatSwitch.click();
  await expect(page.getByText('Im Chat zugelassene Rollen')).toBeVisible();
  await selectOnlyRole(page, 'Baumkontrolle');
  await saveChat(page);
  await publish(page, { via: 'bar' });

  // 3: a participant of that role finds the tile under Werkzeuge, opens it and posts.
  const member = await device(browser, origin, issueToken());
  const message = `Gruß vom Baumkontrolleur ${Date.now()}`;
  try {
    await toolsButton(member.page).click();
    await chatTile(member.page).click();
    const panel = member.page.getByRole('dialog', { name: 'Projekt-Chat' });
    await expect(panel).toBeVisible();
    await panel.getByRole('textbox', { name: 'Nachricht schreiben' }).fill(message);
    await panel.getByRole('button', { name: 'Senden' }).click();
    await expect(panel.getByText(message)).toBeVisible();
  } finally {
    // keep the context for step 5
  }

  // 4: a participant of another role (Bauhof) does not get the tile. The Bauhof device signs in after the publish, so
  // it loads the published config; the positive control is that the Baumkontrolle device, on the same config, has it.
  await member.page.reload();
  await toolsButton(member.page).click();
  await expect(chatTile(member.page)).toBeVisible();
  const other = await device(browser, origin, tokenOfOther());
  try {
    await expect(other.page).not.toHaveURL(/\/login/);
    // The shell is up. The Bauhof role has no Werkzeuge button at all: the bar shows it only with an active tool
    // (BottomBar `toolsActive`, MapScreen `tools.length > 0`) and, with the chat not allowed, Bauhof has none. The
    // button is therefore absent, which is stronger than "no chat tile": nothing to open.
    await expect(other.page.getByRole('banner').or(other.page.getByRole('navigation')).first()).toBeVisible();
    await expect(toolsButton(other.page)).toHaveCount(0);
  } finally {
    await other.context.close();
  }

  // 5: the admin switches the chat off and publishes; after a reload the first participant has no tile.
  await page.goto(SECTION);
  await expect(chatSwitch).toBeChecked();
  await chatSwitch.click();
  await expect(page.getByText('Im Chat zugelassene Rollen')).toHaveCount(0);
  await saveChat(page);
  await publish(page, { via: 'bar' });
  chatMayBeOn = false;
  try {
    await member.page.reload();
    await expect(member.page).not.toHaveURL(/\/login/);
    await expect(async () => {
      await member.page.reload();
      await toolsButton(member.page).click();
      await expect(member.page.getByRole('dialog', { name: 'Werkzeuge', exact: true })).toBeVisible();
      await expect(chatTile(member.page)).toHaveCount(0);
    }).toPass({ timeout: 20_000 });
  } finally {
    await member.context.close();
  }
});
