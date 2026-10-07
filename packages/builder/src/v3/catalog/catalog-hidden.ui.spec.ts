// @vitest-environment jsdom
// WP-452: a hidden template task shows greyed in the catalog with "Einblenden"; a click unhides it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../task/shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';

afterEach(cleanup);

describe('catalog: Einblenden', () => {
  it('lists the hidden template task greyed, and the click unhides it', async () => {
    const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).apply({
      kind: 'hide',
      path: 'tasks.kontrolle',
    }).doc;
    const onchange = vi.fn();
    render(BuilderShell, { doc, type: 'baum', locale: 'de', registry: createBuilderRegistry(), onchange });
    const row = document.querySelector('[data-path="tasks.kontrolle"][data-hidden="true"]') as HTMLElement;
    expect(row).not.toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Einblenden' }));
    const next = onchange.mock.calls.at(-1)?.[0] as Doc;
    expect(next.overlay().hide ?? []).not.toContain('tasks.kontrolle');
    expect(document.querySelector('[data-hidden="true"]')).toBeNull();
  });
});
