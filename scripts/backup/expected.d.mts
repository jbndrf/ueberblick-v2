export interface ExpectedMigrations {
  control: readonly { id: number }[];
  project: readonly { id: number }[];
  migrationState: (
    db: { prepare: (sql: string) => { get: (...p: never[]) => unknown; all: (...p: never[]) => unknown[] } },
    migrations: readonly { id: number; name: string; sql: string }[],
  ) => { pending: number[]; unknown: number[] };
}
export function expectedMigrations(): ExpectedMigrations;
