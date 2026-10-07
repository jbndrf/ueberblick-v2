// Web Worker entry: clustering runs here, off the main thread.
import { createClusterHandler } from './index-core';
import { warmUp } from './warm';
import type { FromWorker, ToWorker } from './protocol';

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: { data: ToWorker }) => void) | null;
};
const handle = createClusterHandler((m) => scope.postMessage(m));
scope.onmessage = (event) => handle(event.data);
// The worker is idle until the first delivery: compile the build loops now (WP-584). Messages queue meanwhile.
warmUp();
