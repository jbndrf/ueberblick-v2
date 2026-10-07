import type { Component } from 'svelte';
import type { CellKind, CellProps } from '../types';
import InputCell from './input-cell.svelte';
import BooleanCell from './boolean-cell.svelte';
import DropdownCell from './dropdown-cell.svelte';
import ArrayCell from './array-cell.svelte';

/** Renderer per kind (v3's field-renderers). A new property type adds one entry; `custom` cells use the column's own snippet. */
export const CELL_RENDERERS: Record<Exclude<CellKind, 'custom'>, Component<CellProps>> = {
  text: InputCell,
  number: InputCell,
  date: InputCell,
  boolean: BooleanCell,
  dropdown: DropdownCell,
  array: ArrayCell,
};
