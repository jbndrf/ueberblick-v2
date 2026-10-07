/**
 * The roster half of "ZIP importieren" (A-046): read and check the roster entries **before** the project is created,
 * so a refused archive creates nothing. A token twice inside the archive refuses the whole import with the typed code
 * `token_duplicate` (a corrupt archive). A token already used on this instance (the scope is the whole instance,
 * `auth/service.ts` `tokenExists`) is reported in `inUse`: the import gives those participants fresh tokens. No message names a token or a person.
 */
import type { ColumnDef } from '../../http/participants/columns';
import type { ArchiveProblem } from './import-zip';
import { ARCHIVE_ENTRIES, type ArchiveManifest } from './manifest';
import {
  ArchiveColumnSchema,
  ArchiveParticipantSchema,
  duplicateTokens,
  tokensOf,
  type ArchiveParticipant,
} from './roster';
import { ZipCorrupt, ArchiveLimitError, type ZipFile } from './zip';

export interface ReadRoster {
  readonly columns: readonly ColumnDef[];
  readonly participants: readonly ArchiveParticipant[];
  /** The archive's tokens that are already used on this instance: those participants get new tokens (A-046). */
  readonly inUse: ReadonlySet<string>;
}

const bad = (path: string, message: string): ArchiveProblem => ({ path, message });

/** `undefined`: the archive has no roster. */
export async function readRoster(
  zip: ZipFile,
  manifest: ArchiveManifest,
  lines: (entry: string) => AsyncIterable<string>,
  usedTokens: (tokens: readonly string[]) => ReadonlySet<string>,
): Promise<ReadRoster | ArchiveProblem | undefined> {
  if (manifest.roster === undefined) return undefined;
  const { rosterColumns, rosterParticipants } = ARCHIVE_ENTRIES;
  if (!zip.has(rosterColumns) || !zip.has(rosterParticipants))
    return bad(rosterParticipants, 'Die Teilnehmenden fehlen im Archiv.');
  let columns: ColumnDef[];
  try {
    const parsed = ArchiveColumnSchema.array().safeParse(JSON.parse(await zip.text(rosterColumns)));
    if (!parsed.success) return bad(rosterColumns, 'Die Spalten der Teilnehmenden sind ungültig.');
    columns = parsed.data as ColumnDef[];
  } catch (e) {
    if (e instanceof ZipCorrupt || e instanceof ArchiveLimitError) throw e;
    return bad(rosterColumns, 'Die Spalten der Teilnehmenden sind kein JSON.');
  }
  const participants: ArchiveParticipant[] = [];
  for await (const line of lines(rosterParticipants)) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return bad(rosterParticipants, 'Eine Zeile der Teilnehmenden ist kein JSON.');
    }
    const p = ArchiveParticipantSchema.safeParse(raw);
    if (!p.success) return bad(rosterParticipants, 'Eine Zeile der Teilnehmenden ist ungültig.');
    participants.push(p.data);
  }
  if (duplicateTokens(participants))
    return {
      path: rosterParticipants,
      message:
        'Ein Zugangstoken kommt im Archiv mehrfach vor. Das Archiv ist beschädigt. Es wurde nichts importiert.',
      code: 'token_duplicate',
    };
  return { columns, participants, inUse: usedTokens(tokensOf(participants)) };
}
