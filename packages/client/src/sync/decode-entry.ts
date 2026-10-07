/** Worker entry: bundle this file as the sync decode worker. It only serves `serveDecoder` on its own scope. */
import { serveDecoder } from './decode';
import type { MessagePortLike } from './decode';

serveDecoder(globalThis as unknown as MessagePortLike);
