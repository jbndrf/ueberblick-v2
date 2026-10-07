// WP-315: `self.$version` is the column `features.pinned_version`, so it is allowed wherever an expression compiles
// to SQL (it was refused until the column existed, WP-311, registry flag `sql: false`).
import { describe, expect, it } from 'vitest';
import { SYSTEM_FIELDS } from '../../registry/system-fields';
import { NO_ASSETS, compile } from '.';
import { checkEnvFor } from './check-env';
import { check } from '../../expr/check';
import { parse } from '../../expr/parse';
import { TemplateFileSchema } from '../file';

const base = {
  schema: 'ueberblick/1',
  template: { key: 'v', version: '1.0.0' },
  types: {
    baum: {
      label: 'Baum',
      properties: { note: { type: 'text', label: 'Notiz' } },
    },
  },
  tasks: {
    pruefen: { label: 'Prüfen', on: 'baum', then: [{ set: { note: "'x'" } }] },
    add: { label: 'Add', on: '$none', creates: 'baum', form: { note: {} } },
  },
};

const messages = (overlay: Record<string, unknown>): string[] => {
  const r = compile(TemplateFileSchema.parse({ ...base, ...overlay }), { assets: NO_ASSETS });
  return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
};

const accepted = (overlay: Record<string, unknown>): string[] =>
  messages(overlay).filter((x) => x.includes('$version'));

describe('self.$version and SQL', () => {
  it('the registry marks every system field as SQL', () => {
    for (const k of SYSTEM_FIELDS.keys) expect(SYSTEM_FIELDS.get(k).sql, k).toBe(true);
    expect(SYSTEM_FIELDS.get('version').column).toBe('pinned_version');
  });

  it('is accepted in visible_when', () => {
    expect(
      accepted({
        types: { baum: { ...base.types.baum, permissions: { visible_when: 'self.$version == 2' } } },
      }),
    ).toEqual([]);
  });

  it('is accepted in a derived relation', () => {
    expect(
      accepted({
        types: {
          baum: { ...base.types.baum, relations: { nachbar: { to: 'baum', derive: 'self.$version == 2' } } },
        },
      }),
    ).toEqual([]);
  });

  it('is accepted in a view filter', () => {
    expect(
      accepted({ views: { v: { label: 'V', source: { type: 'baum', filter: 'self.$version == 2' } } } }),
    ).toEqual([]);
  });

  it('is accepted in the OGC row-filter env (checkEnvFor), and typed int', () => {
    const r = compile(TemplateFileSchema.parse(base), { assets: NO_ASSETS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = checkEnvFor(r.config, 'baum');
    if (!e.ok) throw new Error('env');
    const ok = parse('self.$version == 2');
    if (!ok.ok) throw new Error('parse');
    expect(check(ok.ast, e.env).ok).toBe(true);
    const bad = parse("self.$version == 'x'");
    if (!bad.ok) throw new Error('parse');
    expect(check(bad.ast, e.env).ok).toBe(false);
  });

  it('stays allowed in eval: a task when and an automatic action when', () => {
    expect(
      accepted({
        tasks: {
          ...base.tasks,
          pruefen: { label: 'P', on: 'baum', when: 'self.$version == 2', then: [{ set: { note: "'x'" } }] },
        },
      }),
    ).toEqual([]);
    expect(
      accepted({
        tasks: {
          ...base.tasks,
          pruefen: {
            label: 'P',
            on: 'baum',
            then: [{ set: { note: "'x'" } }],
            auto: { r: { after: 'add', when: 'self.$version == 2' } },
          },
        },
      }),
    ).toEqual([]);
  });
});
