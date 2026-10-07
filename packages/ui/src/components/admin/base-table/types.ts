import type { Component, Snippet } from 'svelte';

/** Renderer kinds (v3's FieldType). A new property type adds one entry here and one in `cells/registry.ts`. */
export const CELL_KINDS = ['text', 'number', 'date', 'boolean', 'array', 'dropdown', 'custom'] as const;
export type CellKind = (typeof CELL_KINDS)[number];

export const DATE_MODES = ['date', 'datetime', 'time'] as const;
export type DateMode = (typeof DATE_MODES)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export type TableRow = Record<string, unknown>;

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
}

export interface TableColumn {
  /** Key of the value in the row; also the column id. */
  key: string;
  label: string;
  kind?: CellKind;
  sortable?: boolean;
  filterable?: boolean;
  editable?: boolean;
  /** `boolean` cells: the switch works outside Bearbeitungsmodus (v3 `booleanConfig.onToggle`, the Status column). */
  live?: boolean;
  copyable?: boolean;
  /** `text` cells with `copyable`: what the copy button puts on the clipboard, when it is not the shown value (a login link for a token). */
  copyValue?: (row: TableRow) => string;
  minWidth?: number;
  /** For `dropdown` and `array` cells. */
  options?: readonly ChoiceOption[];
  dateMode?: DateMode;
  /** Label of the "no value" entry in this column's filter list. */
  emptyLabel?: string;
  /** For `custom` cells. */
  cell?: Snippet<[{ value: unknown; row: TableRow }]>;
  /** `array` cells: shown when no entry is picked (v3 `emptyText`). */
  emptyText?: string;
  /** `array` cells: one pick only, and the picker closes on choosing (v3 `singleSelect`). */
  singleSelect?: boolean;
  /** `array` cells: typing a new name offers "create"; the callback makes the entry and returns it (v3 `onCreateEntity`). */
  onCreateEntity?: (label: string) => Promise<ChoiceOption> | ChoiceOption;
  /** `text` cells: edit in a textarea; Enter adds a line (v3 `multiline`). */
  multiline?: boolean;
  /** `dropdown` cells: the label of the current value, when it is not the option's label (v3 `getDisplayLabel`). */
  getDisplayLabel?: (value: unknown) => string;
  /** `dropdown` cells: replaces the trigger button (v3 `renderTrigger`). */
  renderTrigger?: Snippet<[{ value: unknown; label: string }]>;
  /** `dropdown` cells: replaces the content of one menu entry (v3 `renderOption`). */
  renderOption?: Snippet<[{ option: ChoiceOption }]>;
}

export interface RowMenuItem {
  label: string | ((row: TableRow) => string);
  icon?: Component<{ class?: string }>;
  destructive?: boolean;
  onSelect: (row: TableRow) => void;
}

export interface RowMenu {
  header?: string;
  onEdit?: (row: TableRow) => void;
  items?: readonly RowMenuItem[];
}

export interface AddRowOptions {
  /** Keys that must have a value before the row can be added. */
  requiredKeys?: readonly string[];
  /** Keys the server fills in ("auto"). */
  excludedKeys?: readonly string[];
  defaultValues?: () => TableRow;
}

export interface TableSort {
  key: string;
  direction: SortDirection;
}

/** The state a server-side list needs to answer (query mode). */
export interface TableQuery {
  search: string;
  sort: TableSort | null;
  filters: Readonly<Record<string, readonly string[]>>;
  page: number;
}

/** One entry of a column's filter list when the server counts the values (query mode). */
export interface FilterValue {
  /** The raw value the filter sends back; `EMPTY_FILTER_KEY` stands for "no value". */
  value: string;
  label: string;
  count: number;
}

/** v3's `columnManagement`: the "+" in the last header opens the page's column manager. */
export interface ColumnManagement {
  /** Accessible name of the "+" button (the page's own message, e.g. "Feld hinzufügen"). */
  label: string;
  onOpen: () => void;
}

export interface BaseTableProps {
  rows: readonly TableRow[];
  columns: readonly TableColumn[];
  getRowId?: (row: TableRow) => string;
  selectable?: boolean;
  shiftSelect?: boolean;
  onSelectionChange?: (ids: readonly string[]) => void;
  onRowClick?: (row: TableRow) => void;
  onEdit?: (rowId: string, key: string, value: unknown) => void | Promise<void>;
  /**
   * Row editing (owner answer A1): in Bearbeitungsmodus the edits of a row are collected and the row's check button
   * calls this once with all edited values (column key to value). Throw a `RowRefusal` to mark cells and keep the edits.
   * Replaces `onEdit` for the cells that are not `live`.
   */
  onRowSave?: (rowId: string, values: TableRow) => void | Promise<void>;
  onAdd?: (values: TableRow) => void | Promise<void>;
  onDelete?: (ids: readonly string[]) => void | Promise<void>;
  addRow?: AddRowOptions;
  columnManagement?: ColumnManagement;
  /** Rendered before the confirm button of the add row (v3 `createAreaPrefix`). */
  createAreaPrefix?: Snippet;
  /** The language of the table's own texts (the page's language); the app's locale cookie is not the ui catalogue's. */
  locale?: 'de' | 'en';
  rowMenu?: RowMenu;
  /** When set, the table does not filter or sort itself; the parent answers (server-side lists). */
  onQueryChange?: (query: TableQuery) => void;
  /** Query mode: the search, sort and filters the table starts with (read once), so a page can come back to where it was. */
  initialQuery?: Pick<TableQuery, 'search' | 'sort' | 'filters'>;
  /** Query mode: the values of one column with counts, asked for when its filter list opens (the rows are only a page). */
  filterValues?: (columnKey: string) => Promise<FilterValue[]>;
  /** Query mode: the last rows are in view, so the parent may load the next page. */
  onReachEnd?: () => void;
  /** The first page is on its way: a spinner replaces the empty message. */
  loading?: boolean;
  /** The next page is on its way: a spinner row follows the last row. */
  loadingMore?: boolean;
  /** Accessible name of those spinners. */
  loadingLabel?: string;
  page?: number;
  emptyMessage?: string;
  emptySubMessage?: string;
  showToolbar?: boolean;
  showEditMode?: boolean;
  editModeLabel?: string;
}

/** What every cell renderer receives. */
export interface CellProps {
  value: unknown;
  column: TableColumn;
  rowId: string;
  editable: boolean;
  /** The row the cell belongs to (the add row passes the values typed so far). */
  row?: TableRow | undefined;
  onSave: (value: unknown) => void | Promise<void>;
  /** No "saved" toast (the add row collects values and saves them together). */
  silent?: boolean | undefined;
}

/** Sentinel in a filter list for rows without a value. */
export const EMPTY_FILTER_KEY = '__empty__';
export const ROW_HEIGHT = 49;
export const SELECT_COLUMN = 'select';
export const ACTIONS_COLUMN = 'actions';
