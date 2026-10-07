/**
 * Shapes of the data conversion. The v3 side is a synthetic export of the v3 data tables (instances, their
 * append-only log of what was written to them, custom table rows), built from docs/research/arch-03-data-model-geometry.md.
 * Real exports are a needs-owner item; the reader (`read.ts`) is the one place that spells the v3 key names.
 */
import type { FeatureId, Run } from '@ueberblick/core';
import type { V3Value } from '../diffcheck/types';
import type { DataPhase, DataProblemCode, V3SystemField } from './registry';

export type { V3Value };

/** One row of the v3 log of written values: append-only, in insertion order. */
export interface V3LogRow {
  /** The v3 field key. Absent when the row is a system field. */
  readonly field?: string;
  /** Set instead of `field` for the values v3 projected onto the instance (`project_to`). */
  readonly system?: V3SystemField;
  /** The stored value; a position is GeoJSON (WGS84), a reference a list of v3 record ids. */
  readonly value: unknown;
  /** Who wrote it (a participant id). */
  readonly observer?: string;
  /** When it was observed; falls back to `recordedAt`. */
  readonly observedAt?: string;
  readonly recordedAt: string;
  /** Rows of one task run share it. */
  readonly run: string;
}

export interface V3InstanceRecord {
  readonly id: string;
  readonly workflow: string;
  readonly status?: string;
  readonly stage?: string;
  readonly createdBy?: string;
  readonly createdAt?: string;
  /** The current geometry (GeoJSON, WGS84), used when the log has no geometry row. */
  readonly geometry?: unknown;
  /** The v3 vertex-mean centroid. Never converted: v4 derives it with core.geo. */
  readonly centroid?: unknown;
  readonly log: readonly V3LogRow[];
}

export interface V3TableRecord {
  readonly id: string;
  readonly table: string;
  readonly createdAt?: string;
  /** Column name to value. */
  readonly values: Readonly<Record<string, V3Value>>;
}

/** A v3 user: the id runs name as their observer, and the v3 role keys. Names and contact data are not carried over. */
export interface V3UserRecord {
  readonly id: string;
  readonly roles: readonly string[];
}

export interface V3DataExport {
  readonly format: 1;
  /** The users of the v3 project; they become the roster (`fillRoster`). */
  readonly users: readonly V3UserRecord[];
  readonly instances: readonly V3InstanceRecord[];
  readonly tableRows: readonly V3TableRecord[];
}

export interface DataProblem {
  readonly code: DataProblemCode;
  /** The v3 instance or table row id. */
  readonly record: string;
  readonly message: string;
}

/** One atomic batch: it goes to `Store.submitBatch`. */
export interface RunBatch {
  /** Position in the whole conversion, from 0. Stable for one input, so a checkpoint can name it. */
  readonly index: number;
  readonly phase: DataPhase;
  readonly runs: readonly Run[];
  /** The v3 record of each run (parallel to `runs`). */
  readonly sources: readonly string[];
  /** `sources[i]` is created by `runs[i]`: the driver learns its feature id from the result. */
  readonly creates: boolean;
  /** What could not be carried over while this batch was built. */
  readonly problems: readonly DataProblem[];
}

/** v3 record id to the v4 feature it became; the driver fills it, the `links` phase reads it. */
export interface IdMap {
  get(v3Id: string): FeatureId | undefined;
  set(v3Id: string, id: FeatureId): void;
  entries(): Iterable<readonly [string, FeatureId]>;
}

/** Where an interrupted conversion continues. Plain data: store it as JSON. */
export interface Checkpoint {
  /** The first batch that has not been submitted. */
  readonly next: number;
  readonly ids: Readonly<Record<string, FeatureId>>;
}
