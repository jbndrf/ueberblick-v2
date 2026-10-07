// Lets plain Node load the server's TypeScript sources: Node strips the types itself, this hook only adds the
// extensionless-import resolution the sources use (`./migrate`, `./db`). Used as `node --import ./scripts/backup/register.mjs`.
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);
