// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import './jsdom-shims.testing';
import Sample from './Sample.testing.svelte';

/** data-slot is v3's component marker; the class is a fragment of v3's own classes for that slot. */
const SLOTS: readonly (readonly [string, string])[] = [
  ['button', 'inline-flex'],
  ['card', 'rounded-xl'],
  ['card-title', 'font-semibold'],
  ['tabs-list', 'bg-muted'],
  ['tabs-trigger', 'inline-flex'],
  ['input', 'border-input'],
  ['label', 'text-sm'],
  ['textarea', 'border-input'],
  ['badge', 'rounded-md'],
  ['switch', 'rounded-full'],
  ['checkbox', 'border-input'],
  ['radio-group-item', 'rounded-full'],
  ['separator', 'bg-border'],
  ['progress', 'bg-primary/20'],
  ['skeleton', 'animate-pulse'],
  ['scroll-area', 'relative'],
  ['sheet-content', 'bg-background'],
  ['dialog-content', 'bg-background'],
  ['alert-dialog-content', 'bg-background'],
  ['drawer-content', 'bg-background'],
  ['popover-content', 'bg-popover'],
  ['tooltip-content', 'bg-primary'],
  ['dropdown-menu-content', 'bg-popover'],
  ['dropdown-menu-item', 'rounded-sm'],
];

describe('the v3 kit renders with v3 classes', () => {
  let baseElement: HTMLElement;
  beforeEach(() => {
    baseElement = render(Sample).baseElement;
  });
  for (const [slot, cls] of SLOTS) {
    it(`${slot} carries ${cls}`, () => {
      const el = baseElement.querySelector(`[data-slot="${slot}"]`);
      expect(el, `data-slot=${slot}`).not.toBeNull();
      expect(el?.getAttribute('class')).toContain(cls);
    });
  }
  it('spinner and toaster render', () => {
    expect(baseElement.querySelector('svg[role="status"]')?.getAttribute('class')).toContain('animate-spin');
    expect(baseElement.querySelector('section[aria-label]')).not.toBeNull();
  });
});
