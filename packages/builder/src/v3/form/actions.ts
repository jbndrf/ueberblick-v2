/** What the preview's cards and tabs ask of the editor; the editor turns each into ops. */
export interface Actions {
  select(key: string): void;
  rename(key: string, text: string): void;
  remove(key: string): void;
  del(key: string): void;
  pageText(index: number, part: 'label' | 'hint', text: string): void;
  deletePage(index: number): void;
  addPage(): void;
  openPage(index: number): void;
}
