// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from './BuilderShell.svelte';
import DummyInspector from './DummyInspector.testing.svelte';
import { createBuilderRegistry, PANE_WIDTHS, type PaneWidth } from './registry';
import '../task/shims.testing';

const doc = () => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('right pane width per mode (v3)', () => {
  it('the registry holds v3 widths', () => {
    expect(PANE_WIDTHS).toMatchObject({
      task: 320,
      quick: 320,
      form: 640,
      field: 360,
      tags: 360,
      settings: 352,
      default: 360,
      wide: 520,
      widePalette: 650,
      wideStage: 720,
    });
  });

  it('the registry hands out the width a pane registered, default otherwise', () => {
    const r = createBuilderRegistry();
    r.registerInspector('task', DummyInspector, { width: 'task' });
    r.registerInspector('rule', DummyInspector);
    expect(r.inspector('task')?.width).toBe('task');
    expect(r.inspector('rule')?.width).toBe('default');
  });

  it.each<[PaneWidth, number]>([
    ['task', 320],
    ['form', 640],
    ['settings', 352],
    ['wide', 520],
  ])('the shell gives a "%s" pane %ipx', (width, px) => {
    const registry = createBuilderRegistry();
    registry.registerInspector('none', DummyInspector, { width });
    render(BuilderShell, { doc: doc(), type: 'baum', locale: 'de', registry });
    expect((screen.getByTestId('builder-inspector') as HTMLElement).style.getPropertyValue('--pane-w')).toBe(
      `${px}px`,
    );
  });
});

describe('catalog heading', () => {
  it('lists Aktionen in one list where it said Aufgaben and Automatisierungen (C-004)', () => {
    render(BuilderShell, { doc: doc(), type: 'baum', locale: 'de', registry: createBuilderRegistry() });
    const catalog = screen.getByTestId('builder-catalog');
    expect(catalog.textContent).toContain('Aktionen');
    expect(catalog.textContent).not.toMatch(/\bRegeln\b|Automatisierungen/);
  });
});
