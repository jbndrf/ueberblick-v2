import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/**
 * What every generated journey candidate starts from (scripts/ui/codegen.mjs): a fresh data directory for one
 * golden project, served by the built web app on a random port, the page signed in as the seeded admin.
 * It is the same seeding as `ui.mjs seed`, so a candidate starts exactly where the explorer did.
 */
export interface SeededApp {
  readonly url: string;
  stop(): Promise<void>;
}

interface SeedSession {
  runDir: string;
  page: Page;
  app?: { kill(): boolean };
  seedCount?: number;
}
interface SeedModule {
  seed(s: SeedSession, fixture: string): Promise<{ data: { url: string } }>;
  stopApp(s: SeedSession): void;
}

const SEED = fileURLToPath(new URL('../../../../scripts/ui/seed.mjs', import.meta.url));

export async function seedApp(page: Page, fixture: string): Promise<SeededApp> {
  const mod = (await import(SEED)) as SeedModule;
  const runDir = mkdtempSync(join(tmpdir(), 'ueberblick-candidate-'));
  const session: SeedSession = { runDir, page };
  const { data } = await mod.seed(session, fixture);
  return {
    url: data.url,
    async stop() {
      mod.stopApp(session);
      rmSync(runDir, { recursive: true, force: true });
    },
  };
}
