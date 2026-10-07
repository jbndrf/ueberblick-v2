/** One choice in a MultiSelect (v3's `getOptionId` / `getOptionLabel` / `getOptionDescription` as plain fields). */
export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string | undefined;
}

/** Every text the component shows; each defaults to the `multi_select_*` message. */
export interface MultiSelectLabels {
  placeholder: string;
  search: string;
  empty: string;
  createHint: string;
  createLabel: (query: string) => string;
  countSelected: (count: number) => string;
  removeOption: (label: string) => string;
  done: string;
  doneWithCount: (count: number) => string;
  close: string;
  dialog: string;
  options: string;
}
