// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Icon from '../components/Icon.svelte';
import * as icons from './index';
import { axeViolations } from '../testing/axe';

const all = Object.values(icons);

describe('icons', () => {
  it('are plain data with unique names and at least one path', () => {
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((i) => i.name)).size).toBe(all.length);
    for (const i of all) expect(i.paths.length).toBeGreaterThan(0);
  });

  it('draw with currentColor only: no literal colours in path data', () => {
    for (const i of all) for (const p of i.paths) expect(p).not.toMatch(/#|rgb|fill=/);
  });

  it('render as inline SVG using currentColor', () => {
    for (const icon of all) {
      const { container, unmount } = render(Icon, { icon });
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      unmount();
    }
  });

  it('is decorative (aria-hidden) without a label', () => {
    const { container } = render(Icon, { icon: icons.iconClock });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });

  it('has an accessible name with a label', () => {
    const { getByRole } = render(Icon, { icon: icons.iconClock, label: 'Pending' });
    expect(getByRole('img', { name: 'Pending' }).getAttribute('aria-hidden')).toBeNull();
  });

  it('has no axe violations, labelled or not', async () => {
    const a = render(Icon, { icon: icons.iconClock });
    const b = render(Icon, { icon: icons.iconClock, label: 'Pending' });
    expect(await axeViolations(a.container)).toEqual([]);
    expect(await axeViolations(b.container)).toEqual([]);
  });

  it('is tree-shakable: one module per icon and the package declares no side effects', () => {
    const dir = import.meta.dirname;
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.spec.ts'),
    );
    expect(files.length).toBe(all.length);
    const pkg = JSON.parse(readFileSync(join(dir, '../../package.json'), 'utf8')) as {
      sideEffects: boolean;
    };
    expect(pkg.sideEffects).toBe(false);
  });
});
