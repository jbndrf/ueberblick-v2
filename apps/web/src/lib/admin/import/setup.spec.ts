import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { importSetupOf } from './setup';

const file = {
  types: {
    baum: {
      label: { de: 'Baum' },
      geometry: 'geometrie',
      process: { property: 'stage', start: 'erfasst', end: ['erledigt'] },
      properties: {
        geometrie: { type: 'geometry', geometry_type: 'point', required: true },
        stage: {
          type: 'select',
          label: { de: 'Status' },
          options: { erfasst: { de: 'Erfasst' }, kontrolliert: { de: 'Kontrolliert' }, erledigt: 'Erledigt' },
        },
        art: { type: 'text', label: { de: 'Art' }, required: true },
        hoehe_m: { type: 'number', label: { de: 'Höhe (m)' } },
        beschreibung: { type: 'localized_text', label: { de: 'Beschreibung' } },
        foto: { type: 'file', label: 'Foto' },
        gepflanzt: { type: 'date', label: 'Gepflanzt' },
        intern: { type: 'text' },
      },
    },
    tabelle: { label: 'T', properties: { name: { type: 'text' } } },
  },
  tasks: {
    kontrolle: { label: 'K', on: 'baum', form: { intern: {} } },
    erfassen: {
      label: { de: 'Baum erfassen' },
      on: '$map',
      creates: 'baum',
      form: {
        geometrie: { tool: 'draw', required: true },
        art: {},
        hoehe_m: { required: true },
        beschreibung: {},
        foto: {},
      },
    },
  },
} as unknown as TemplateFile;

describe('importSetupOf: what the wizard maps onto', () => {
  const s = importSetupOf(file, 'baum', 'de');

  it('finds the task that creates the type', () => {
    expect(s?.task).toBe('erfassen');
    expect(s?.taskLabel).toBe('Baum erfassen');
  });

  it('lists its form fields as targets: labels, required stars, no geometry and no files', () => {
    expect(s?.fields.map((f) => [f.key, f.label, f.required])).toEqual([
      ['art', 'Art', true],
      ['hoehe_m', 'Höhe (m)', true],
      ['beschreibung', 'Beschreibung', false],
    ]);
    expect(s?.fields.find((f) => f.key === 'beschreibung')?.language).toBe('de');
    expect(s?.fields.find((f) => f.key === 'hoehe_m')?.kind).toBe('number');
  });

  it('a point geometry gives the longitude and latitude columns, required as the geometry is', () => {
    expect(s?.geometry).toEqual({ field: 'geometrie', point: true, required: true });
  });

  it('the stage is offered as "Wert für alle Zeilen", starting at the process start', () => {
    expect(s?.stage).toEqual({
      property: 'stage',
      label: 'Status',
      start: 'erfasst',
      options: [
        { value: 'erfasst', label: 'Erfasst' },
        { value: 'kontrolliert', label: 'Kontrolliert' },
        { value: 'erledigt', label: 'Erledigt' },
      ],
    });
  });

  it('other simple properties can take a value for all rows; geometry, files and the stage cannot', () => {
    expect(s?.constants.map((c) => c.key)).toEqual(['art', 'hoehe_m', 'gepflanzt', 'intern']);
    expect(s?.constants.find((c) => c.key === 'gepflanzt')?.kind).toBe('date');
  });

  it('a role property takes a role of the project as the value for all rows (WP-478)', () => {
    const withRole = {
      ...file,
      roles: { kontrolle: { label: { de: 'Kontrolle' } } },
      types: {
        ...file.types,
        baum: {
          ...file.types?.['baum'],
          properties: {
            ...file.types?.['baum']?.properties,
            zustaendig: { type: 'role', label: 'Zuständig' },
          },
        },
      },
    } as unknown as TemplateFile;
    const c = importSetupOf(withRole, 'baum', 'de')?.constants.find((x) => x.key === 'zustaendig');
    expect(c).toMatchObject({ kind: 'role', options: [{ value: 'kontrolle', label: 'Kontrolle' }] });
  });

  it('a type no task creates, or an unknown type, has no setup', () => {
    expect(importSetupOf(file, 'gibtsnicht', 'de')).toBeNull();
  });

  it('a table page for an Objektart has no setup', () => {
    expect(importSetupOf(file, 'baum', 'de', { table: true })).toBeNull();
  });

  it('a Tabelle (no geometry, no process) maps onto its properties and runs `$create` of its type (WP-433)', () => {
    const t = importSetupOf(
      {
        types: {
          arten: {
            label: 'Arten',
            properties: {
              name: { type: 'text', label: { de: 'Name' }, required: true },
              lat: { type: 'text', label: { de: 'Latein' } },
              anzahl: { type: 'number' },
              bild: { type: 'file' },
            },
          },
        },
      } as unknown as TemplateFile,
      'arten',
      'de',
      { table: true },
    );
    expect(t).toMatchObject({ task: '$create', type: 'arten', geometry: null, stage: null });
    expect(t?.fields.map((f) => [f.key, f.label, f.required])).toEqual([
      ['name', 'Name', true],
      ['lat', 'Latein', false],
      ['anzahl', 'anzahl', false],
    ]);
  });

  it('a type without a process has no stage; a line geometry has no coordinate columns', () => {
    const f = {
      types: { weg: { geometry: 'g', properties: { g: { type: 'geometry', geometry_type: 'line' } } } },
      tasks: { neu: { on: '$map', creates: 'weg', form: { g: {} } } },
    } as unknown as TemplateFile;
    const w = importSetupOf(f, 'weg', 'de');
    expect(w?.stage).toBeNull();
    expect(w?.geometry).toEqual({ field: 'g', point: false, required: false });
  });
});
