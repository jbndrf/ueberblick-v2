export { createPrefsClient, prefsCacheKey, type PrefsClientDeps } from './client';
export { httpPrefsTransport, webKeyValueStorage } from './adapters';
export type { KeyValueStorage, PrefsClient, PrefsListener, PrefsReply, PrefsTransport } from './contract';
