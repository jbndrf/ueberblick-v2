// @vitest-environment jsdom
// WP-668: every refusal kind of a pack file is told in the user's language (de and en), never as a raw error string.
import { afterEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { PACK_REFUSALS, type PackRefusal } from '@ueberblick/client';
import type { Offline } from '../../../offline/model';
import ImportSection from './ImportSection.svelte';

afterEach(cleanup);

const DE: Record<PackRefusal, string> = {
  not_a_pack: 'Die Datei ist kein Offline-Paket.',
  truncated: 'Die Datei ist unvollständig.',
  trailing_bytes: 'Die Datei enthält Daten nach der letzten Kartenebene.',
  sha256_mismatch: 'Die Prüfsumme einer Kartenebene stimmt nicht, die Datei ist beschädigt.',
  wrong_project: 'Das Paket gehört nicht zu diesem Projekt.',
  unsupported_version: 'Diese Paketdatei hat ein Format, das die App nicht kennt.',
  bad_manifest: 'Die Paketbeschreibung in der Datei ist ungültig.',
  unsafe_name: 'Die Datei enthält ungültige Namen.',
  not_supported: 'Dieser Browser kann keine Offline-Pakete speichern.',
  write_failed: 'Das Paket konnte nicht gespeichert werden, vielleicht ist der Speicher voll.',
};
const EN: Record<PackRefusal, string> = {
  not_a_pack: 'The file is not an offline pack.',
  truncated: 'The file is incomplete.',
  trailing_bytes: 'The file has data after its last map layer.',
  sha256_mismatch: 'The checksum of a map layer is wrong, the file is damaged.',
  wrong_project: 'The pack does not belong to this project.',
  unsupported_version: 'This pack file has a format the app does not know.',
  bad_manifest: 'The pack description in the file is invalid.',
  unsafe_name: 'The file contains invalid names.',
  not_supported: 'This browser cannot store offline packs.',
  write_failed: 'The pack could not be saved, the storage may be full.',
};

/** An Offline whose manager refuses every file with `kind` (the detail string must never reach the screen). */
const refusing = (kind: PackRefusal): Offline =>
  ({
    supported: true,
    manager: { importPack: async () => ({ ok: false, kind, reason: 'RAW developer detail' }) },
  }) as unknown as Offline;

const file = (): File =>
  Object.assign(new File(['x'], 'p.ubpack'), {
    stream: () => new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
  });

describe('import refusals', () => {
  for (const [locale, words, failed] of [
    ['de', DE, 'Import fehlgeschlagen'],
    ['en', EN, 'Import failed'],
  ] as const)
    for (const kind of PACK_REFUSALS.keys) {
      it(`${locale}: ${kind}`, async () => {
        render(ImportSection, {
          props: { offline: refusing(kind), locale, disabled: false, importing: false },
        });
        await userEvent.setup().upload(screen.getByTestId('import-input'), file());
        await waitFor(() =>
          expect(screen.getByTestId('import-failed').textContent?.trim()).toBe(`${failed}: ${words[kind]}`),
        );
        expect(document.body.textContent).not.toContain('RAW developer detail');
      });
    }
});
