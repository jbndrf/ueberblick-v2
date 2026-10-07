/**
 * Where a request for the participant app goes when nobody is signed in (WP-731). v3 redirected in its route guard
 * (reference/src/routes/(participant)/+layout.server.ts:24); v4's participant app has no server rendering, so the
 * server hook asks this before it serves the page. The person then reaches /login without the app first asking for
 * a bootstrap that the browser would log as a failed 401 request. A device that is offline never reaches the server,
 * so its cached identity still opens the app (`loadBootstrap`).
 */
export function signedOutRedirect(request: {
  readonly method: string;
  readonly path: string;
  readonly signedIn: boolean;
}): string | undefined {
  return request.method === 'GET' && request.path === '/map' && !request.signedIn ? '/login' : undefined;
}
