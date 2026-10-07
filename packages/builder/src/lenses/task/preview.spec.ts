import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { openProject } from '../../doc';
import { goldenDoc, must } from '../process/fixtures';
import { setFieldAttrOps } from './edit';
import { buildPreview, previewRoles } from './preview';

const doc = () => goldenDoc('baumkataster', '2.0.0');

describe('buildPreview', () => {
  it('builds the participant form session for the task, on a generated feature', () => {
    const p = buildPreview(doc().effective(), 'kontrolle', 'kontrolle', 'en');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.session.model.fields.map((f) => f.key)).toEqual([
      'vitalitaet',
      'befund',
      'foto',
      'hoehe_m',
      'hoehe_klasse',
    ]);
    // core.form decides relevance: foto reads form.vitalitaet
    expect(p.session.isRelevant('befund')).toBe(true);
    expect(p.session.isRequired('befund')).toBe(true);
    expect(p.session.isReadonly('hoehe_klasse')).toBe(true);
  });

  it('follows an edit of the form: a field made not required is not required in the preview', () => {
    const d = doc();
    const edited = must(
      setFieldAttrOps(d, 'kontrolle', 'befund', 'required', undefined).reduce(
        (cur, op) => cur.apply(op).doc,
        d,
      ),
    );
    const p = buildPreview(edited.effective(), 'kontrolle', 'kontrolle', 'en');
    expect(p.ok && p.session.isRequired('befund')).toBe(false);
  });

  it('works for a task with no feature to sit on ($map creates, $none)', () => {
    expect(buildPreview(doc().effective(), 'erfassen', 'kontrolle', 'de').ok).toBe(true);
    expect(buildPreview(doc().effective(), 'baumart_anlegen', 'verwaltung', 'de').ok).toBe(true);
  });

  it('switches role (H3): the roles are the file roles', () => {
    const roles = previewRoles(doc().effective());
    expect(roles.length).toBeGreaterThan(1);
    for (const r of roles) expect(buildPreview(doc().effective(), 'kontrolle', r.value, 'en').ok).toBe(true);
  });

  it('says why there is no preview instead of drawing nothing', () => {
    const broken = doc().apply({
      kind: 'set',
      path: 'tasks.kontrolle.form.befund.calculate',
      value: 'self.gibtsnicht',
    });
    const p = buildPreview(broken.doc.effective(), 'kontrolle', 'kontrolle', 'en');
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe('does_not_compile');
    const none = buildPreview(doc().effective(), 'nix', 'kontrolle', 'en');
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe('no_task');
  });
});

describe('buildPreview: bind variables (WP-629)', () => {
  it('a form expression reading a bind variable is true, as on the device (core bindsFor)', () => {
    const d = doc()
      .apply({ kind: 'set', path: 'tasks.kontrolle.bind.me', value: 'self' })
      .doc.apply({ kind: 'set', path: 'tasks.kontrolle.form.befund.relevant', value: 'me != null' }).doc;
    const p = buildPreview(d.effective(), 'kontrolle', 'kontrolle', 'en');
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.session.isRelevant('befund')).toBe(true);
  });
});

describe('buildPreview: a bind field (A-047)', () => {
  it('builds the form of a task whose form edits a bound Objekt', () => {
    const root = resolve(import.meta.dirname, '../../../../../fixtures/golden');
    const doc = openProject(
      embedGoldenSource(readFileSync(resolve(root, 'templates/baumkataster/1.1.0.yaml'), 'utf8')),
      readFileSync(resolve(root, 'projects/musterstadt-bind-field.yaml'), 'utf8'),
    );
    const p = buildPreview(doc.effective(), 'flaeche_pruefen', 'kontrolle', 'en');
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.session.model.fields.map((f) => f.key)).toEqual(['area.name']);
  });
});
