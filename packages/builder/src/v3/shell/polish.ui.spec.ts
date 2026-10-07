// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';
import { render, screen } from '@testing-library/svelte';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { messages } from '../../shell/messages';
import { registerCanvas } from '../canvas';
import '../canvas/jsdom.testing';
import DummyInspector from './DummyInspector.testing.svelte';
import BuilderShell from './BuilderShell.svelte';
import { createBuilderRegistry } from './registry';
import { refusalText } from './refusal';

/** WP-516: the polish items of the builder frame that a unit can prove. */
const doc = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const t = messages('de');

function mount(d: Doc) {
  const registry = createBuilderRegistry();
  registerCanvas(registry);
  for (const k of ['stage', 'task', 'rule', 'none'] as const) registry.registerInspector(k, DummyInspector);
  return render(BuilderShell, { doc: d, type: 'baum', locale: 'de', registry });
}

describe('refusal text (WP-516 item 4)', () => {
  it('a locked path says "Von der Vorlage gesperrt", anything else the generic German line', () => {
    const lockedOp = { kind: 'set', path: 'types.baum.properties.stage.options', value: [] } as const;
    const freeOp = { kind: 'add', path: 'tasks.x', value: {} } as const;
    expect(refusalText(t, doc(), [lockedOp])).toBe('Von der Vorlage gesperrt');
    expect(refusalText(t, doc(), [freeOp])).toBe('Das ist nicht möglich.');
  });

  it('no builder file shows the engine refusal text (`refused.message`) to the admin', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(svelte|ts)$/.test(e.name) && !/(spec|testing)\.ts$/.test(e.name) && !isPlanted(p)) {
          const src = readFileSync(p, 'utf8');
          if (/\{\s*message:\s*[\w.]*refused[\w?.]*message/.test(src)) offenders.push(p);
          if (/error = r\.refused\.message/.test(src)) offenders.push(p);
        }
      }
    };
    walk(join(import.meta.dirname, '..'));
    expect(offenders).toEqual([]);
  });
});

describe('toolbar and canvas (WP-516 items 1, 3)', () => {
  it('the unsaved line keeps its slot while saved, so the first edit moves nothing', () => {
    mount(doc());
    const slot = document.querySelector('.unsaved') as HTMLElement;
    expect(slot.classList.contains('saved')).toBe(true);
    expect(screen.queryByTestId('unsaved')).toBeNull();
  });

  it('"Phase hinzufügen" is disabled with the lock wording where the template locks the stage options', () => {
    mount(doc());
    const button = screen.getByTestId('canvas-add-stage') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Von der Vorlage gesperrt');
  });
});
