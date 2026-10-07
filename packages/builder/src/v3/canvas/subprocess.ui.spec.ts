// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import './jsdom.testing';
import { registerCanvas } from './index';

const typeHref = (type: string) => `/types/${type}/builder`;

function mount(type: string, withHref = true) {
  const registry = createBuilderRegistry();
  registerCanvas(registry);
  const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
  return render(BuilderShell, { doc, type, locale: 'de', registry, ...(withHref ? { typeHref } : {}) });
}
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('sub-process links on the canvas (S4-5)', () => {
  it("the parent's task shows 'verknüpft' and the child's process name, and links to the child's builder", () => {
    mount('baum');
    const link = document.querySelector('[data-task-id="massnahme_anlegen"] a[data-subprocess-link]');
    expect(text(link)).toBe('verknüpft: Maßnahme');
    expect(link?.getAttribute('href')).toBe('/types/massnahme/builder');
    expect(document.querySelectorAll('a[data-subprocess-link]').length).toBe(1);
    expect(screen.queryByTestId('subprocess-back')).toBeNull();
  });

  it("the child's canvas links back: 'Teil-Ablauf von: <Elternart>'", () => {
    mount('massnahme');
    const back = screen.getByTestId('subprocess-back');
    expect(text(back)).toBe('Teil-Ablauf von: Baum');
    expect(back.querySelector('a')?.getAttribute('href')).toBe('/types/baum/builder');
    expect(document.querySelector('a[data-subprocess-link]')).toBeNull();
  });

  it('without addresses from the host there are no links', () => {
    mount('baum', false);
    expect(document.querySelector('a[data-subprocess-link]')).toBeNull();
    cleanup();
    mount('massnahme', false);
    expect(screen.queryByTestId('subprocess-back')).toBeNull();
  });
});
