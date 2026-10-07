// @vitest-environment jsdom
// WP-506: "Projektdatei vergleichen": the red/green line diff of the project file, live against draft.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import ProjectCompare from './ProjectCompare.svelte';
import type { ProjectFiles } from './deploy-client';

afterEach(cleanup);

const mount = (files: ProjectFiles | null, locale: 'de' | 'en' = 'de') =>
  render(ProjectCompare, { locale, client: { compare: async () => files } });
const open = async (): Promise<void> => {
  await userEvent.click(
    screen.getByRole('button', { name: /Projektdatei vergleichen|Compare project file/ }),
  );
};
const many = (n: number): string => Array.from({ length: n }, (_, i) => `k${i}: ${i}`).join('\n') + '\n';

describe('ProjectCompare', () => {
  it('shows added and removed lines with a summary, and folds the unchanged run', async () => {
    const live = many(200);
    mount({ live, draft: live.replace('k100: 100', 'k100: 101') });
    await open();
    await waitFor(() =>
      expect(screen.getByTestId('compare-summary').textContent).toContain('1 Zeilen hinzugefügt, 1 entfernt'),
    );
    expect(document.querySelector('[data-op="add"]')?.textContent).toContain('k100: 101');
    expect(document.querySelector('[data-op="remove"]')?.textContent).toContain('k100: 100');
    expect(screen.getAllByRole('button', { name: /unveränderte Zeilen/ })).toHaveLength(2);
    expect(document.querySelectorAll('[data-op]').length).toBeLessThan(20);
  });

  it('side by side: live left in red, draft right in green, a changed line on one row', async () => {
    mount({ live: 'a: 1\nb: 2\n', draft: 'a: 1\nb: 3\n' });
    await open();
    await screen.findByTestId('compare-grid');
    const pair = document.querySelector('[data-row="pair"]') as HTMLElement;
    const [left, right] = Array.from(pair.children) as HTMLElement[];
    expect(left?.dataset.op).toBe('remove');
    expect(left?.textContent).toContain('b: 2');
    expect(left?.className).toContain('bg-red');
    expect(right?.dataset.op).toBe('add');
    expect(right?.textContent).toContain('b: 3');
    expect(right?.className).toContain('bg-green');
    expect(left?.getAttribute('aria-label')).toBe('Entfernte Zeile');
  });

  it('a folded run opens on tap', async () => {
    const live = many(50);
    mount({ live, draft: live.replace('k25: 25', 'k25: x') });
    await open();
    const fold = (await screen.findAllByRole('button', { name: /unveränderte Zeilen/ }))[0];
    await userEvent.click(fold as HTMLElement);
    expect(screen.getByTestId('compare-lines').textContent).toContain('k10: 10');
  });

  it('never published: every line is new', async () => {
    mount({ live: null, draft: 'a: 1\nb: 2\n' }, 'en');
    await open();
    expect((await screen.findByTestId('compare-summary')).textContent).toContain('Not published yet');
    expect(document.querySelectorAll('[data-op="add"]')).toHaveLength(2);
  });

  it('no difference and a failed load are said', async () => {
    mount({ live: 'a: 1\n', draft: 'a: 1\n' });
    await open();
    expect(await screen.findByText('Keine Unterschiede zwischen live und Entwurf.')).toBeTruthy();
    cleanup();
    mount(null);
    await open();
    expect((await screen.findByRole('alert')).textContent).toContain('konnte nicht geladen werden');
  });
});
