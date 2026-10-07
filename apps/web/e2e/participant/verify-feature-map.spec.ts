import { devices, expect, type Page } from '@playwright/test';
import { readState } from './map-world';
import {
  acceptedRuns,
  CENTER,
  CROWD,
  openByName,
  propsOf,
  signInVerify,
  test,
  unique,
} from './helpers/verify-world';
import { watchErrors } from './world';

/**
 * WP-834 (step-2 verify): the feature sheet and the map elements the register lists as built but not driven in the
 * real participant UI, at Pixel 7 (phone) and 1280x800 (desktop), de-DE. v3 sources: open-work count
 * `relation-graph.ts:88,216` / `RelationPath.svelte:107-114,177`; inline edit the v3 detail module `:1212-1255`;
 * children follow the parent `+page.svelte:2189-2252`; cluster worker `lib/workers/cluster-worker.ts:1-60`.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
test.setTimeout(90_000);

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 600;
const mapBox = async (page: Page): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await page.getByTestId('map').boundingBox();
  if (box === null) throw new Error('no map box');
  return box;
};
/** Where the tree stands when it is picked off the list: a field away from the crowd at the start view. */
const FAR: readonly [number, number] = [CENTER[0] + 0.3, CENTER[1]];

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems).toEqual([]);
    });

    test('open-work pill: the count of children with open work for the person, in the path, the menu and the list', async ({
      page,
      world,
    }, info) => {
      const treeName = unique('Pille', size, info);
      const tree = await world.plant(treeName, FAR);
      await world.defect(tree, unique('d1', size, info));
      await world.defect(tree, unique('d2', size, info));
      const done = await world.defect(tree, unique('d3', size, info));
      await world.send('defekt_beheben', { kommentar: 'erledigt' }, done);
      await signInVerify(page, unique('p-pill', size, info));
      await openByName(page, treeName);
      // the path: a red count of the children that still need this person, with v3's sentence as its name
      const pill = page.getByTestId('relation-path').getByTestId('relation-open-work');
      await expect(pill).toBeVisible();
      await expect(pill).toHaveText('2');
      await expect(pill).toHaveAccessibleName('2 mit offenen Aufgaben für Sie');
      // the relation menu: the relation with its child count (3) and the same open-work count
      await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
      const item = page.getByRole('menuitem', { name: /Defekte/ });
      await expect(item).toBeVisible();
      await expect(item).toContainText('3');
      await expect(item.getByTestId('relation-open-work')).toHaveAccessibleName(
        '2 mit offenen Aufgaben für Sie',
      );
      // the list: a dot on each child with open work, the finished one faded and without
      await item.click();
      const rows = page.getByTestId('relation-row');
      await expect(rows).toHaveCount(3);
      await expect(rows.getByRole('img', { name: 'Offene Aufgaben für Sie' })).toHaveCount(2);
      await expect(rows.filter({ has: page.locator('[data-finished="true"]') })).toHaveCount(0);
      await expect(page.locator('[data-testid="relation-row"][data-finished="true"]')).toHaveCount(1);
    });

    // v3 `TaskRunNotices.svelte`, `Module:205-211`: a run the device itself refuses shows the red box "Nicht möglich"
    // with the sentence, and nothing is queued. Here the task stops being available while its form is open.
    test('local refusal: the red "Nicht möglich" box with the reason, nothing queued', async ({
      page,
      world,
    }, info) => {
      const treeName = unique('Refus', size, info);
      const tree = await world.plant(treeName, FAR);
      const defect = await world.defect(tree, unique('d', size, info));
      await signInVerify(page, unique('p-refus', size, info));
      await openByName(page, treeName);
      await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
      await page.getByRole('menuitem', { name: /Defekte/ }).click();
      await page.getByTestId('relation-row').first().click();
      await page.getByRole('button', { name: 'Defekt beheben' }).click();
      await page.getByLabel(/^Kommentar/).fill('fast fertig');
      // somebody else fixes the defect meanwhile; the sync brings it to this device
      await world.send('defekt_beheben', { kommentar: 'erledigt' }, defect);
      await expect.poll(() => propsOf(defect)['stage'], { timeout: 20_000 }).toBe('behoben');
      await page.waitForTimeout(3_000);
      const before = acceptedRuns('defekt_beheben');
      await page.getByRole('button', { name: 'Absenden' }).click();
      const box = page.getByTestId('run-local-refusal');
      await expect(box).toBeVisible({ timeout: 10_000 });
      await expect(box).toContainText('Nicht möglich');
      await expect(page.getByTestId('run-pending')).toHaveCount(0);
      expect(acceptedRuns('defekt_beheben')).toBe(before);
    });

    // the v3 detail module `:1212-1255`: Bearbeiten makes the values in Daten editable, the action row
    // becomes Abbrechen | Speichern; Abbrechen drops the input, Speichern is one run with the changed values.
    test('inline edit: Bearbeiten, Abbrechen drops the input, Speichern saves one run', async ({
      page,
      world,
    }, info) => {
      const treeName = unique('Edit', size, info);
      const tree = await world.plant(treeName, FAR, { notiz: 'alt', hoehe: 5 });
      await signInVerify(page, unique('p-edit', size, info));
      await openByName(page, treeName);
      const runs = acceptedRuns('stammdaten');
      await page.getByRole('button', { name: 'Bearbeiten' }).click();
      await page.getByRole('tab', { name: 'Daten' }).click();
      await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Speichern' })).toBeVisible();
      await expect(page.getByLabel(/^Notiz/)).toHaveValue('alt');
      await page.getByLabel(/^Notiz/).fill('verworfen');
      await page.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(page.getByLabel(/^Notiz/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
      await expect(page.getByText('alt', { exact: true })).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(acceptedRuns('stammdaten')).toBe(runs);
      await page.getByRole('button', { name: 'Bearbeiten' }).click();
      await page.getByLabel(/^Notiz/).fill('neu');
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect.poll(() => acceptedRuns('stammdaten'), { timeout: 20_000 }).toBe(runs + 1);
      await expect.poll(() => propsOf(tree)['notiz'], { timeout: 20_000 }).toBe('neu');
      await expect(page.getByLabel(/^Notiz/)).toHaveCount(0);
      await expect(page.getByText('neu', { exact: true })).toBeVisible();
    });

    // v3 `+page.svelte:2189-2252` (inherit): the children sit on the parent's spot and move with it. In v4 nothing is
    // written to the children: the map reads the parent's position, so the fan moves by the same distance.
    test('children follow the parent: after the parent moves, the fan moved with it and no child was written', async ({
      page,
      world,
    }, info) => {
      const treeName = unique('Eltern', size, info);
      const tree = await world.plant(treeName, FAR);
      const kids = [
        await world.defect(tree, unique('k1', size, info)),
        await world.defect(tree, unique('k2', size, info)),
      ];
      await signInVerify(page, unique('p-follow', size, info));
      await openByName(page, treeName);
      await page.getByRole('button', { name: 'Verknüpfte Objekte' }).click();
      await page.getByRole('menuitem', { name: /Defekte/ }).click();
      const fan = page.locator('.maplibregl-marker button');
      await expect(fan).toHaveCount(2);
      await page.waitForTimeout(600); // the pop-in
      const x0 = (await fan.first().boundingBox())?.x ?? NaN;
      const map = page.getByTestId('map');
      const [defects, spans] = [acceptedRuns('defekt_anlegen'), Number(await map.getAttribute('data-span'))];
      const box = await mapBox(page);
      const D = 0.0006;
      await world.send(
        'verschieben',
        { geometrie: { type: 'Point', coordinates: [FAR[0] + D, FAR[1]] } },
        tree,
      );
      const expected = (D * box.width) / spans;
      await expect
        .poll(async () => Math.abs(((await fan.first().boundingBox())?.x ?? NaN) - x0 - expected), {
          timeout: 20_000,
        })
        .toBeLessThan(4);
      await expect(fan).toHaveCount(2);
      // nothing was written to the children: no run of theirs, and they still have no position
      expect(acceptedRuns('defekt_anlegen')).toBe(defects);
      for (const kid of kids) expect(propsOf(kid)['geometrie']).toBeUndefined();
    });

    // v3 `cluster-worker.ts` + `ClusterDetailModule`: a crowd is one group whose counts are reduced per value; a feature
    // that arrives later is added to the group, and the group opens into its members when zoomed in.
    test('cluster: a crowd is one group with counts per value; a new feature joins; the group opens into singles', async ({
      page,
      world,
    }, info) => {
      await world.crowd();
      await signInVerify(page, unique('p-cluster', size, info));
      await expect(page.getByTestId('map')).toHaveAttribute('data-idle', 'true', { timeout: 30_000 });
      await expect
        .poll(async () => (await readState(page))?.clusters, { timeout: 30_000 })
        .toBeGreaterThanOrEqual(1);
      const box = await mapBox(page);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const sheet = page.getByTestId('cluster-sheet');
      await expect(sheet).toBeVisible();
      const count = async (row: string): Promise<number> =>
        Number(
          /(\d+) Objekt/.exec(
            await sheet.getByTestId('cluster-row').filter({ hasText: row }).innerText(),
          )?.[1],
        );
      const total = async (): Promise<number> =>
        Number(/(\d+) Objekte/.exec(await sheet.getByRole('heading').first().innerText())?.[1]);
      const [n, good, weak] = [await total(), await count('Gut'), await count('Schwach')];
      expect(n).toBeGreaterThanOrEqual(CROWD);
      expect(good + weak).toBe(n); // the counts per value add up to the group
      await expect(sheet.getByTestId('cluster-row').filter({ hasText: 'Gut' })).toBeVisible();
      await expect(sheet.getByTestId('cluster-row').filter({ hasText: 'Gut' })).toContainText(
        `${Math.round((good / n) * 100)}%`,
      );
      // a row opens the group into its members (the counts per value are the singles drawn), the row again restores it
      const start = await readState(page);
      await sheet.getByTestId('cluster-row').filter({ hasText: 'Gut' }).click();
      await expect.poll(async () => (await readState(page))?.singles, { timeout: 20_000 }).toBe(good);
      expect((await readState(page))?.clusters).toBe(0);
      await sheet.getByTestId('cluster-row').filter({ hasText: 'Gut' }).click();
      await expect
        .poll(async () => (await readState(page))?.clusters, { timeout: 20_000 })
        .toBe(start?.clusters);
      await page.mouse.click(box.x + 30, box.y + box.height * 0.3);
      await expect(sheet).toBeHidden();
      // a tree that arrives later is drawn at once, as a single beside the group; the group's counts may lag by the
      // index's bound (`index-core.ts` pending overlay: exact for single features, counts inside clusters may lag)
      const before = await readState(page);
      await world.plant(unique('Neu', size, info), [CENTER[0] + 0.0036, CENTER[1]], { zustand: 'schwach' });
      await expect
        .poll(async () => (await readState(page))?.singles, { timeout: 30_000 })
        .toBe((before?.singles ?? 0) + 1);
      expect((await readState(page))?.clusters).toBe(before?.clusters);
    });
  });
}

export { isPhone, mapBox, readState };
