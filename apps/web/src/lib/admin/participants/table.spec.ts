import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyForm, formOf, labelTaken, withEdited, without } from '../columns/form';
import { columnKeyOf, withAdded } from './columns';
import { KEYS, attrKey, attrValue, loginLink, patchOf, rowsOf, tableColumns } from './table';
import type { CustomColumn, RosterPerson } from './types';

const person = (over: Partial<RosterPerson> = {}): RosterPerson => ({
  id: 'anna-1a2b3c',
  name: 'Anna',
  email: 'anna@example.org',
  phone: null,
  roles: ['kontrolle'],
  attrs: { personalnummer: '4711' },
  disabledAt: null,
  selfJoined: false,
  token: 'AAAA-BBBB-CCCC-DDDD-EEEE',
  ...over,
});
const PN: CustomColumn = { key: 'personalnummer', label: 'Personalnummer', type: 'text', required: true };

describe('rowsOf: the roster as v3 shows it', () => {
  it('maps the six columns and the admin columns', () => {
    const [row] = rowsOf([person()], [PN]);
    expect(row).toEqual({
      id: 'anna-1a2b3c',
      name: 'Anna',
      email: 'anna@example.org',
      phone: '',
      token: 'AAAA-BBBB-CCCC-DDDD-EEEE',
      roles: ['kontrolle'],
      is_active: true,
      attr_personalnummer: '4711',
    });
  });

  it('a disabled person is inactive; a person without token has an empty cell', () => {
    const [row] = rowsOf([person({ disabledAt: '2026-01-01T00:00:00Z', token: null })], []);
    expect(row).toMatchObject({ is_active: false, token: '' });
  });
});

describe('tableColumns', () => {
  const setup = {
    locale: 'de' as const,
    origin: 'https://ueb.test',
    roles: [
      { key: 'kontrolle', label: 'Kontrolle', pending: false },
      { key: 'praktikum', label: 'Praktikum', pending: true },
    ],
    columns: [PN],
    createRole: async () => null,
  };

  it('has v3 columns in v3 order with German labels, then the admin columns', () => {
    const cols = tableColumns(setup);
    expect(cols.map((c) => c.label)).toEqual([
      'Name',
      'E-Mail',
      'Telefon',
      'Zugangstoken',
      'Rollen',
      'Status',
      'Personalnummer',
    ]);
    expect(cols.map((c) => c.kind)).toEqual(['text', 'text', 'text', 'text', 'array', 'boolean', 'text']);
  });

  it('English labels in English', () => {
    expect(tableColumns({ ...setup, locale: 'en' }).map((c) => c.label)).toContain('Access token');
  });

  it('the token copies the login link, not the token', () => {
    const token = tableColumns(setup).find((c) => c.key === KEYS.token);
    expect(token?.copyable).toBe(true);
    expect(token?.copyValue?.({ token: 'AB-12' })).toBe('https://ueb.test/login?token=AB-12');
  });

  it('a role only in the draft is marked as new in the picker', () => {
    const roles = tableColumns(setup).find((c) => c.key === KEYS.roles);
    expect(roles?.options?.map((o) => [o.value, o.description !== undefined])).toEqual([
      ['kontrolle', false],
      ['praktikum', true],
    ]);
  });

  it('Status is a live switch', () => {
    expect(tableColumns(setup).find((c) => c.key === KEYS.active)).toMatchObject({
      kind: 'boolean',
      live: true,
    });
  });

  it('creating a role goes through createRole and returns the option; a refusal throws', async () => {
    const made = tableColumns({
      ...setup,
      createRole: async (name) => ({ key: 'x', label: name, pending: true }),
    }).find((c) => c.key === KEYS.roles);
    expect(await made?.onCreateEntity?.('Neu')).toMatchObject({ value: 'x', label: 'Neu' });
    const refused = tableColumns(setup).find((c) => c.key === KEYS.roles);
    await expect(Promise.resolve(refused?.onCreateEntity?.('Neu'))).rejects.toThrow();
  });
});

describe('patchOf: what an edit sends', () => {
  it('maps each cell to the roster route', () => {
    expect(patchOf(KEYS.name, 'Berta', [])).toEqual({ name: 'Berta' });
    expect(patchOf(KEYS.email, '', [])).toEqual({ email: null });
    expect(patchOf(KEYS.phone, '+49 1', [])).toEqual({ phone: '+49 1' });
    expect(patchOf(KEYS.roles, ['a', 'b'], [])).toEqual({ roles: ['a', 'b'] });
    expect(patchOf(KEYS.active, false, [])).toEqual({ disabled: true });
    expect(patchOf(KEYS.active, true, [])).toEqual({ disabled: false });
  });

  it('an admin column is typed and an empty value clears it', () => {
    const n: CustomColumn = { key: 'alter', label: 'Alter', type: 'number' };
    expect(patchOf(attrKey('alter'), '42', [n])).toEqual({ attrs: { alter: 42 } });
    expect(patchOf(attrKey('alter'), '', [n])).toEqual({ attrs: { alter: null } });
    expect(patchOf('unknown', 'x', [n])).toBeNull();
  });
});

describe('attrValue', () => {
  it('turns typed text into the column type', () => {
    expect(attrValue('number', '3.5')).toBe(3.5);
    expect(attrValue('boolean', 'true')).toBe(true);
    expect(attrValue('boolean', false)).toBe(false);
    expect(attrValue('date', '2026-05-01')).toBe('2026-05-01');
    expect(attrValue('text', '')).toBeNull();
  });
});

describe('loginLink', () => {
  it('is the page the sign-in reads, with the token escaped', () => {
    expect(loginLink('https://a.b', 'x y')).toBe('https://a.b/login?token=x%20y');
  });
});

describe('columnKeyOf (property)', () => {
  it('is always a valid, unused key', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string(), { maxLength: 6 }), (label, taken) => {
        const key = columnKeyOf(label, new Set(taken));
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(taken).not.toContain(key);
        expect(['email', 'phone']).not.toContain(key);
      }),
    );
  });

  it('reads a German name', () => {
    expect(columnKeyOf('Größe (cm)', new Set())).toBe('groesse_cm');
    expect(columnKeyOf('Personalnummer', new Set(['personalnummer']))).toBe('personalnummer_2');
    expect(columnKeyOf('E-Mail', new Set())).toBe('e_mail');
    expect(columnKeyOf('Phone', new Set())).toBe('phone_2');
  });
});

describe('column list edits', () => {
  const form = { ...emptyForm('text'), label: 'Personalnummer', required: true };

  it('add: a new column with the typed default and the required flag', () => {
    const list = withAdded([], { ...form, defaultText: '0' });
    expect(list).toEqual([
      { key: 'personalnummer', label: 'Personalnummer', type: 'text', default: '0', required: true },
    ]);
  });

  it('edit keeps the key; delete removes it', () => {
    const list = withAdded([], form);
    const edited = withEdited(list, 'personalnummer', { ...formOf(list[0] as CustomColumn), label: 'PN' });
    expect(edited[0]).toMatchObject({ key: 'personalnummer', label: 'PN' });
    expect(without(edited, 'personalnummer')).toEqual([]);
  });

  it('a name that exists already is taken (v3: "existiert bereits")', () => {
    const list = withAdded([], form);
    expect(labelTaken(list, ' personalnummer ')).toBe(true);
    expect(labelTaken(list, 'personalnummer', 'personalnummer')).toBe(false);
  });
});
