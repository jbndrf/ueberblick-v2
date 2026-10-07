/** A hand-made project for erasure: personal properties of every subject kind and the tasks that erase them. */
import type { CompiledConfig } from '../../schema/compile/contract';
import { build } from './world';

const open = { see: '$all', create: '$all', write: '$all' } as const;

export const erasureFile = (): Record<string, unknown> => ({
  schema: 'ueberblick/1',
  template: { key: 'erasure', version: '1.0.0' },
  roles: { admin: { label: 'Admin' }, worker: { label: 'Worker' } },
  types: {
    position: {
      label: 'Position',
      permissions: open,
      properties: { wo: { type: 'text', personal: { subject: 'actor' } }, note: { type: 'text' } },
    },
    meldung: {
      label: 'Meldung',
      permissions: open,
      properties: {
        melder: { type: 'participant', select: { all: ['worker'] } },
        telefon: { type: 'text', required: true, personal: { subject: 'property:melder' } },
        ort: { type: 'text' },
      },
    },
    person: {
      label: 'Person',
      permissions: open,
      properties: { name: { type: 'text', personal: { subject: 'feature' } }, note: { type: 'text' } },
    },
    loeschung: {
      label: 'Loeschung',
      permissions: open,
      properties: {
        subject: { type: 'participant', select: { all: ['worker'] } },
        a: { type: 'participant', select: { all: ['worker'] } },
        b: { type: 'participant', select: { all: ['worker'] } },
      },
    },
    zaehler: {
      label: 'Zaehler',
      permissions: open,
      properties: { n: { type: 'integer' }, d: { type: 'text' } },
    },
  },
  tasks: {
    add_position: { label: 'Add position', on: '$none', creates: 'position', form: { wo: {}, note: {} } },
    add_meldung: {
      label: 'Add meldung',
      on: '$none',
      creates: 'meldung',
      form: { melder: {}, telefon: {}, ort: {} },
    },
    add_person: { label: 'Add person', on: '$none', creates: 'person', form: { name: {}, note: {} } },
    add_zaehler: { label: 'Add zaehler', on: '$none', creates: 'zaehler', form: { n: {} } },
    /** A personal integer echoed by a failing expression: the refusal must not carry it. */
    pick: {
      label: 'Pick',
      on: 'zaehler',
      form: { n: {} },
      then: [{ set: { n: '[1, 2][form.n]' } }],
    },
    /** A personal string parsed as a date by a failing function: the refusal must not carry it. */
    pick_date: {
      label: 'Pick date',
      on: 'zaehler',
      form: { d: {} },
      then: [{ set: { n: 'days_between(date(form.d), date(form.d))' } }],
    },
    erase_subject: {
      label: 'Erase subject',
      on: '$none',
      creates: 'loeschung',
      form: { subject: { required: true } },
      then: [{ redact: { subject: 'actor', of: 'form.subject' } }],
    },
    /** Two `redact` steps in one run: each subject keeps its own pairs. */
    erase_two: {
      label: 'Erase two subjects',
      on: '$none',
      creates: 'loeschung',
      form: { a: { required: true }, b: { required: true } },
      then: [{ redact: { subject: 'actor', of: 'form.a' } }, { redact: { subject: 'actor', of: 'form.b' } }],
    },
    erase_melder: {
      label: 'Erase melder',
      on: '$none',
      creates: 'loeschung',
      form: { subject: { required: true } },
      then: [{ redact: { subject: 'property:melder', of: 'form.subject' } }],
    },
    erase_person: {
      label: 'Erase person',
      on: 'person',
      then: [{ redact: { subject: 'feature' } }],
    },
  },
});

export const erasure = (): CompiledConfig => build(erasureFile());
