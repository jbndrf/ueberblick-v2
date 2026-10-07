/**
 * Subject data export (WP-535, B-005, docs/research/gdpr-erasure.md section 9). CONTRACT: changes need the lead.
 *
 * `exportSubject(project, subjectId, actor)` returns the bytes of a ZIP as a stream. It is a read, not a run.
 * The subject is a participant id (their runs, and personal properties naming them) or a feature id (personal
 * properties with `subject: feature`). Access is recorded through the `AccessLog` port: who, when, which subject,
 * never a value.
 */
import type { Clock, CompiledConfig } from '@ueberblick/core';
import type { BlobService } from '../blobs';
import type { Db } from '../db/driver';

export interface AccessLogEntry {
  readonly at: string;
  /** The admin who exported. */
  readonly actor: string;
  readonly action: string;
  /** The participant or feature id the export is about. */
  readonly subject: string;
}

/** Where accesses to personal data are recorded (`access_log` table; the sink holds ids and times only). */
export interface AccessLog {
  record(entry: AccessLogEntry): void;
}

/** Everything one export reads. */
export interface ProjectExport {
  readonly key: string;
  readonly db: Db;
  readonly blobs: Pick<BlobService, 'get'>;
  /** The deployed config: which properties are personal, and their labels. */
  readonly config: Pick<CompiledConfig, 'file'>;
  readonly configVersion: number;
  readonly clock: Clock;
  readonly accessLog: AccessLog;
}
