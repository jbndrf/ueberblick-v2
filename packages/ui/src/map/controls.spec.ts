// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { describeMap } from './controls';
import { axeViolations } from '../testing/axe';

const labels = { map: 'Map of trees', mapDescription: 'The same trees are listed under Show list.' };

describe('describeMap', () => {
  it('names the map element and points to the list in its description', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const undo = describeMap(el, labels);
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Map of trees');
    const id = el.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(id)?.textContent).toBe(labels.mapDescription);
    expect(await axeViolations(el)).toEqual([]);
    undo();
    expect(el.getAttribute('aria-label')).toBeNull();
    expect(document.getElementById(id)).toBeNull();
    el.remove();
  });
});
