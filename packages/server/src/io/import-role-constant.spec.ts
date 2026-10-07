import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { planImport } from './import';
import { importSetup, TREE_MAPPING } from './testkit';
import type { ImportDeps } from './contract';

// WP-478: a role constant ('Wert für alle Zeilen') names a role by key or label, as a role column does.
const CSV = 'vit;x;y;z\nv1;500000;5538630;100';
const mapping = { ...TREE_MAPPING, sourceCrs: 'EPSG:25832' } as const;

function withRole(): ImportDeps {
  const { deps } = importSetup();
  const file = deps.config.file;
  const baum = file.types?.['baum'];
  if (baum === undefined) throw new Error('golden project has no baum');
  return {
    ...deps,
    config: {
      ...deps.config,
      file: {
        ...file,
        roles: { ...file.roles, kontrolle: { label: { de: 'Kontrolle', en: 'Inspection' } } },
        types: {
          ...file.types,
          baum: { ...baum, properties: { ...baum.properties, zustaendig: { type: 'role' } } },
        },
      },
    } as ImportDeps['config'],
  };
}

describe('role constant in the mapping', () => {
  it('a role label resolves to the role key', () => {
    const p = planImport(
      { format: 'csv', data: CSV },
      { ...mapping, constants: { zustaendig: 'inspection' } },
      withRole(),
    );
    expect(p.problems).toEqual([]);
    expect(p.runs[0]?.input).toMatchObject({ constants: { zustaendig: 'kontrolle' } });
  });
  it('an unknown role refuses the file', () => {
    const p = planImport(
      { format: 'csv', data: CSV },
      { ...mapping, constants: { zustaendig: 'nobody' as Key } },
      withRole(),
    );
    expect(p.runs).toEqual([]);
    expect(p.problems[0]).toMatchObject({ code: 'mapping_invalid' });
  });
});
