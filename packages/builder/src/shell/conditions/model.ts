/**
 * The condition view (R1): a condition's source and its chips as core reads them (`toChips`, R5).
 * The task and rule models build their condition rows with it.
 */
import type { ChipsResult } from '@ueberblick/core';
import { chipsOfSource } from './chips';

export interface ConditionView {
  readonly source: string;
  readonly chips: ChipsResult;
}

export const conditionOf = (source: string): ConditionView => ({ source, chips: chipsOfSource(source) });
