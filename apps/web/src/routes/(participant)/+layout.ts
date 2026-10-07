// The participant app is client-only: IndexedDB, MapLibre and the run queue have no server rendering. The server
// still answers `/map` and `/login` with the app shell page and the cookie decides what the client loads.
export const ssr = false;
export const prerender = false;
