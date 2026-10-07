import { routeFor, START_REDIRECT, type RequestFacts } from './routing';

export interface HandlerDeps {
  readonly origin: string;
  /** Pathnames of the precached build and static files. */
  readonly assets: ReadonlySet<string>;
  /** Looks a path up in the current build's cache. */
  readonly match: (path: string) => Promise<Response | undefined>;
  readonly fetch: (request: Request) => Promise<Response>;
  /** Refetches a shell in the background and replaces the cached copy (the worker stays alive until it ends). */
  readonly revalidate: (path: string) => void;
}

export const factsOf = (request: Request, navigate: boolean): RequestFacts => ({
  url: new URL(request.url),
  method: request.method,
  navigate,
});

/** Only a direct, successful answer is a shell: a redirected one (e.g. /map to /login signed out) cannot answer a navigation. */
export const storableShell = (res: Response): boolean => res.ok && !res.redirected;

/**
 * The answer for one fetch event, or `undefined` when the worker leaves the request to the browser (data endpoints,
 * other origins, pages it does not own: the browser asks the server and nothing is cached). A shell or asset that is
 * not cached falls through to the network, so a first visit on a bad install still works.
 */
export async function respond(
  request: Request,
  navigate: boolean,
  deps: HandlerDeps,
): Promise<Response | undefined> {
  const facts = factsOf(request, navigate);
  const route = routeFor(facts, deps.origin, deps.assets);
  switch (route.kind) {
    case 'shell': {
      const cached = await deps.match(route.shell);
      // A redirected entry (stored by an earlier build) is poisoned: the network answers and the entry is replaced.
      if (!cached) return deps.fetch(request);
      if (cached.redirected) {
        deps.revalidate(route.shell);
        return deps.fetch(request);
      }
      // Stale-while-revalidate: the start stays instant, and the next start has the shell the server sends now, with its
      // Content-Security-Policy (a map host deployed since the install is allowed from then on, WP-957).
      deps.revalidate(route.shell);
      return cached;
    }
    case 'asset':
      return (await deps.match(facts.url.pathname)) ?? deps.fetch(request);
    case 'network-or-map':
      return deps.fetch(request).catch(() => Response.redirect(new URL(START_REDIRECT, facts.url).href, 302));
    case 'network':
      return undefined;
  }
}
