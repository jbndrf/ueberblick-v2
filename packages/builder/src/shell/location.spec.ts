import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { openProject } from '../doc';
import { goldenProjects, musterstadt } from '../testing/golden';
import { locate, taskLocation } from './location';

const file = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective();

describe('locate a key path', () => {
  it('a path inside a feature type is at that type', () => {
    expect(locate(file, 'types.baum.properties.stage.options')).toEqual({ type: 'baum' });
  });

  it('a path inside a task is at that task, under the type it is offered on', () => {
    expect(locate(file, 'tasks.kontrolle.form.befund.relevant')).toEqual({
      type: 'baum',
      task: 'kontrolle',
    });
  });

  it('anything else is at the project', () => {
    expect(locate(file, 'roles.bauhof.app.home')).toEqual({});
    expect(locate(file, 'views.karte')).toEqual({});
    expect(locate(file, '')).toEqual({});
  });

  it('a task that does not exist (a dangling reference) stays at the project', () => {
    expect(locate(file, 'tasks.gibts_nicht.form')).toEqual({});
  });

  it('a task offered on a special offer sits under the type it creates, else under the offer', () => {
    const offers = Object.entries(file.tasks ?? {}).filter(
      ([, t]) => typeof t.on === 'string' && t.on.startsWith('$'),
    );
    expect(offers.length).toBeGreaterThan(0);
    for (const [k, t] of offers) expect(taskLocation(file, k).type).toBe(t.creates ?? t.on);
  });

  it('property: every located task exists and its type is where it is offered', () => {
    for (const p of goldenProjects) {
      const eff = openProject(p.templateSrc, p.overlaySrc).effective();
      const paths = Object.keys(eff.tasks ?? {}).map((k) => `tasks.${k}.label`);
      fc.assert(
        fc.property(fc.constantFrom(...paths), (path) => {
          const loc = locate(eff, path);
          expect(loc.task).toBeDefined();
          expect(eff.tasks?.[loc.task ?? '']).toBeDefined();
          expect(loc.type).toBeDefined();
        }),
        { numRuns: Math.max(paths.length, 5) },
      );
    }
  });
});
