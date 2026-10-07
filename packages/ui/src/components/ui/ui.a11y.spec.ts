// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import './jsdom-shims.testing';
import Sample from './Sample.testing.svelte';
import { axeViolations } from '../../testing/axe';

describe('the v3 kit is accessible', () => {
  it('a page with button, tabs, input and inline parts has no axe violations', async () => {
    const { container } = render(Sample, { overlays: false });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('an open sheet has no axe violations', async () => {
    const { baseElement } = render(Sample);
    const sheet = baseElement.querySelector('[data-slot="sheet-content"]');
    expect(sheet).not.toBeNull();
    expect(await axeViolations(sheet as Element)).toEqual([]);
  });
});
