import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parse, stringify } from 'yaml';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-416: the builder's problems list speaks the admin's language. A draft with a dangling reference shows its
 * problem in German with the value filled in (the badge list of the Objektart builder, v3's problem count), and
 * `GET /builder-api/<project>/problems?locale=en` words the same problem in English. WP-421: the detail of an
 * expression error (here a `when` that is no bool) is worded in the admin's language too, with the types filled in.
 * Phone and desktop size.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: size.viewport });

    test('a problem of the draft is worded in German in the list and in English by the API', async ({
      page,
      playwright,
      baseURL,
    }) => {
      const key = `prob_${size.name}`;
      expect(admin(['create-project', key, `Probleme ${key}`]).status).toBe(0);
      const email = `${key}@example.org`;
      createAdmin(email);
      expect(admin(['add-membership', email, key, 'verwaltung']).status).toBe(0);
      expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
      const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
      expect((await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);
      const first = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
      expect(await (await ctx.post(`/api/admin/p/${key}/deploy`, { data: first })).json()).toMatchObject({
        ok: true,
      });

      const draft = (await (await ctx.get(`/builder-api/${key}/draft`)).json()) as {
        overlay: string;
        revision: number;
      };
      const overlay = parse(draft.overlay) as { override?: Record<string, unknown> };
      overlay.override = {
        ...overlay.override,
        'types.baum.properties.art.to': 'gibt_es_nicht',
        'tasks.kontrolle.when': '1 + 1',
      };
      const put = await ctx.put(`/builder-api/${key}/draft`, {
        data: { overlay: stringify(overlay), revision: draft.revision },
      });
      expect(put.status()).toBe(200);

      const english = (await (await ctx.get(`/builder-api/${key}/problems?locale=en`)).json()) as {
        problems: { message: string; hint?: string }[];
      };
      expect(english.problems[0]?.message).toBe('"gibt_es_nicht" is not a known feature type.');
      expect(english.problems.map((p) => p.message)).toContain(
        'The expression "1 + 1" does not fit: Expected bool but the expression is int.',
      );

      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(`/admin/projects/${key}/types/baum/builder`);
      await page.getByTestId('problems-badge').click();
      const list = page.getByRole('region', { name: 'Probleme' });
      await expect(list).toContainText('Objektart „gibt_es_nicht“ gibt es nicht.');
      await expect(list).toContainText(
        'Der Ausdruck „1 + 1“ passt nicht: Erwartet wird bool, der Ausdruck ergibt aber int.',
      );
      await expect(list).not.toContainText('is not a known');
      await expect(list).not.toContainText('Expected bool');
      await ctx.dispose();
    });
  });
}
