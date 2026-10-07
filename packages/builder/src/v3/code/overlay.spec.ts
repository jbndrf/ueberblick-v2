// WP-440: the "Anpassungen" text of one Objektart and the task's form text, headless.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { overlayYaml } from './overlay';
import { formYaml } from './form-yaml';

const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('overlayYaml: only what concerns this Objektart', () => {
  it('lists the override and add entries below the type and its tasks, nothing else', () => {
    const text = overlayYaml(doc, 'baum', 'de');
    expect(text).toBeDefined();
    const data = parse(text ?? '') as Record<string, Record<string, unknown>>;
    expect(Object.keys(data['override'] ?? {}).sort()).toEqual([
      'tasks.kontrolle.label',
      'types.baum.properties.vitalitaet.label',
    ]);
    expect(Object.keys(data['add'] ?? {})).toEqual(['types.baum.properties.patenschaft']);
    // the project-wide entries (inputs, views) are not this Objektart's
    expect(data['inputs']).toBeUndefined();
    expect(text).not.toContain('paten:');
  });

  it('is empty for an Objektart the overlay does not touch', () => {
    expect(overlayYaml(doc, 'flaeche', 'de')).toBe('');
  });

  it('follows an edit: a renamed property label shows up', () => {
    const r = doc.apply({ kind: 'set', path: 'types.flaeche.label', value: { de: 'Fläche neu' } });
    expect(r.refused).toBeUndefined();
    expect(overlayYaml(r.doc, 'flaeche', 'de')).toContain('Fläche neu');
  });

  it('is undefined for a template without content (the empty project)', () => {
    const empty = openProject(
      'schema: ueberblick/1\ntemplate: { key: leer, version: 1.0.0 }\n',
      'schema: ueberblick/1\nextends: leer@1\n',
    );
    expect(overlayYaml(empty, 'baum', 'de')).toBeUndefined();
  });
});

describe('formYaml: the task form as text', () => {
  it('parses back to the same form (and steps when the task has them)', () => {
    const task = doc.effective().tasks?.['kontrolle'];
    expect(task?.form).toBeDefined();
    const back = parse(formYaml(doc, 'kontrolle')) as { form: unknown; steps?: unknown };
    expect(back.form).toEqual(task?.form);
    expect(back.steps).toEqual(task?.steps);
  });

  it('is empty for an unknown task', () => {
    expect(formYaml(doc, 'gibt_es_nicht')).toBe('');
  });
});
