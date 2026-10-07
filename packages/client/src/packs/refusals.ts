// Why the device refuses a pack file (WP-668, R6): the one list of kinds. The Offline tab shows one translated message
// per kind (`participant_offline_packages_refusal_<kind>`); the detail string of a refusal is for logs, never shown.
import { defineRegistry, type KeyOf } from '@ueberblick/core/registry';

export const PACK_REFUSALS = defineRegistry([
  {
    key: 'not_a_pack',
    description: 'The file is not an offline pack file (wrong magic, unreadable manifest).',
  },
  { key: 'truncated', description: 'The file ends before the manifest or a layer is complete.' },
  { key: 'trailing_bytes', description: 'The file has bytes after its last layer.' },
  { key: 'sha256_mismatch', description: 'A layer does not match the sha256 in the manifest.' },
  { key: 'wrong_project', description: 'The pack is not one of the packs of this project.' },
  { key: 'unsupported_version', description: 'The file is a pack file of a version this app does not know.' },
  {
    key: 'bad_manifest',
    description: 'The manifest is not a valid pack entry or its layer table does not match.',
  },
  { key: 'unsafe_name', description: 'A hash or layer name could leave the pack directory.' },
  { key: 'not_supported', description: 'This browser has no offline storage for packs.' },
  { key: 'write_failed', description: 'The device could not store the pack (no room, or a storage error).' },
] as const);
export type PackRefusal = KeyOf<typeof PACK_REFUSALS>;
