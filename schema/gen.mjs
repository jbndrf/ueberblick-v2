// Writes schema/ueberblick-1.schema.json from the Zod schema in packages/core (npm run gen:schema).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const mod = await server.ssrLoadModule('/packages/core/src/schema/json-schema.ts');
  const out = fileURLToPath(new URL('./ueberblick-1.schema.json', import.meta.url));
  writeFileSync(out, mod.serializeJsonSchema());
  console.log(`wrote ${out}`);
} finally {
  await server.close();
}
