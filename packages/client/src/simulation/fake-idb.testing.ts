/**
 * fake-indexeddb (6.x) keeps every transaction it ever ran in `Database.transactions`, and each one keeps its
 * rollback log (structured clones of the rows it replaced). In a simulation of 10,000 runs that is gigabytes: a
 * leak of the test double, not of the store. A browser frees a finished transaction. This drops the finished
 * ones, so a long simulation stays flat.
 */
interface RawDatabase {
  transactions: { readonly _state: string }[];
}

export function pruneFinishedTransactions(factory: object): void {
  const databases = (factory as { _databases?: ReadonlyMap<string, RawDatabase> })._databases;
  if (databases === undefined) return;
  for (const db of databases.values())
    db.transactions = db.transactions.filter((t) => t._state !== 'finished');
}
