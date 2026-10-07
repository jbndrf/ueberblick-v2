import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { setTemplateInputs, templateView } from './template-doc';
import type { SettingsEdit } from './settings-doc';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
// musterstadt-baeume sets kontrollintervall_monate: 18 over the template's default 12.
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));
const must = (r: SettingsEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};

describe('the Vorlage section (WP-448)', () => {
  it('shows the template, its version and the inputs with their effective value', () => {
    const v = templateView(open().effective(), 'de');
    expect(v).toMatchObject({ key: 'baumkataster', version: '1.1.0' });
    expect(v.inputs).toEqual([
      expect.objectContaining({
        key: 'kontrollintervall_monate',
        type: 'integer',
        editable: true,
        label: 'Kontrollintervall (Monate)',
        value: 18,
      }),
    ]);
  });

  it('writes a changed value as the overlay input, and the effective value follows', () => {
    const doc = must(setTemplateInputs(open(), { kontrollintervall_monate: 6 }));
    expect(doc.dirty).toBe(true);
    expect(templateView(doc.effective(), 'de').inputs[0]?.value).toBe(6);
    expect(doc.save().overlaySrc).toContain('kontrollintervall_monate: 6');
  });

  it("drops the overlay's own entry when the value is the template's default", () => {
    const doc = must(setTemplateInputs(open(), { kontrollintervall_monate: 12 }));
    expect(templateView(doc.effective(), 'de').inputs[0]?.value).toBe(12);
    expect(doc.save().overlaySrc).not.toContain('kontrollintervall_monate');
  });

  it('refuses an unknown input and a value of the wrong type', () => {
    expect(setTemplateInputs(open(), { gibt_es_nicht: 1 })).toMatchObject({ ok: false, code: 'refused' });
    expect(setTemplateInputs(open(), { kontrollintervall_monate: 1.5 })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(setTemplateInputs(open(), { kontrollintervall_monate: 'x' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });

  describe('multiselect and localized_text inputs (WP-484)', () => {
    const extra =
      '  farben: { type: multiselect, default: [rot], options: { rot: { de: Rot }, blau: { de: Blau } }, label: { de: Farben } }\n' +
      '  hinweis: { type: localized_text, label: { de: Hinweis } }\n';
    const openMore = (): Doc =>
      openProject(
        golden('templates/baumkataster/1.1.0.yaml').replace('\nlock:', `\n${extra}\nlock:`),
        golden('projects/musterstadt-baeume.yaml'),
      );

    it('lists both as editable with their options', () => {
      const v = templateView(openMore().effective(), 'de');
      expect(v.inputs.find((i) => i.key === 'farben')).toMatchObject({
        editable: true,
        value: ['rot'],
        options: [
          { key: 'rot', label: 'Rot' },
          { key: 'blau', label: 'Blau' },
        ],
      });
      expect(v.inputs.find((i) => i.key === 'hinweis')).toMatchObject({ editable: true });
    });

    it('saves a list of offered keys and a text per language; refuses others', () => {
      const doc = must(setTemplateInputs(openMore(), { farben: ['rot', 'blau'], hinweis: { de: 'Hallo' } }));
      const view = templateView(doc.effective(), 'de');
      expect(view.inputs.find((i) => i.key === 'farben')?.value).toEqual(['rot', 'blau']);
      expect(view.inputs.find((i) => i.key === 'hinweis')?.value).toEqual({ de: 'Hallo' });
      expect(setTemplateInputs(openMore(), { farben: ['gruen'] })).toMatchObject({
        ok: false,
        code: 'invalid',
      });
      expect(setTemplateInputs(openMore(), { hinweis: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
    });
  });
});
