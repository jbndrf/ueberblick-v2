/**
 * The slice of the IndexedDB API the store uses, as structural types.
 * The store takes an `IdbEnv` (a port), so it runs in a tab, a worker and under fake-indexeddb, and
 * needs no DOM typings. Real `indexedDB` and `IDBKeyRange` satisfy these shapes.
 */
export type IdbKey = string | number | readonly IdbKey[];

export interface IdbRequest<T = unknown> {
  readonly result: T;
  readonly error: { readonly name: string; readonly message: string } | null;
  onsuccess: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface IdbOpenRequest extends IdbRequest<IdbDatabase> {
  readonly transaction: IdbTransaction | null;
  onupgradeneeded: ((ev: { readonly oldVersion: number }) => void) | null;
  onblocked: ((ev: unknown) => void) | null;
}

export interface IdbCursor {
  readonly value: unknown;
  readonly primaryKey: IdbKey;
  continue(): void;
  advance(count: number): void;
  delete(): IdbRequest;
}

export interface IdbIndex {
  get(key: IdbKey): IdbRequest;
  count(range?: unknown): IdbRequest<number>;
}

export interface IdbObjectStore {
  put(value: unknown, key?: IdbKey): IdbRequest;
  add(value: unknown): IdbRequest<IdbKey>;
  get(key: IdbKey): IdbRequest;
  delete(key: IdbKey | unknown): IdbRequest;
  clear(): IdbRequest;
  count(range?: unknown): IdbRequest<number>;
  getAll(range?: unknown): IdbRequest<unknown[]>;
  getAllKeys(range?: unknown): IdbRequest<IdbKey[]>;
  openCursor(range?: unknown, direction?: string): IdbRequest<IdbCursor | null>;
  index(name: string): IdbIndex;
  createIndex(name: string, keyPath: string | readonly string[], options?: { unique?: boolean }): IdbIndex;
}

export interface IdbTransaction {
  readonly error: { readonly name: string; readonly message: string } | null;
  oncomplete: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onabort: ((ev: unknown) => void) | null;
  objectStore(name: string): IdbObjectStore;
  abort(): void;
}

export interface IdbDatabase {
  readonly objectStoreNames: { contains(name: string): boolean };
  onversionchange: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  createObjectStore(
    name: string,
    options?: { keyPath?: string | readonly string[]; autoIncrement?: boolean },
  ): IdbObjectStore;
  transaction(stores: string | readonly string[], mode?: string): IdbTransaction;
  close(): void;
}

export interface IdbFactory {
  /** With no version, opens the current version and never upgrades (used by the export path). */
  open(name: string, version?: number): IdbOpenRequest;
}

export interface IdbKeyRangeStatic {
  bound(lower: IdbKey, upper: IdbKey): unknown;
  only(key: IdbKey): unknown;
}

/** Everything the store needs from the platform. */
export interface IdbEnv {
  readonly factory: IdbFactory;
  readonly keyRange: IdbKeyRangeStatic;
}
