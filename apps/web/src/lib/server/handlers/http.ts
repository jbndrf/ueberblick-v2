import type { RequestEvent } from '@sveltejs/kit';

/**
 * What a handler needs of a SvelteKit request event. The two sessions of the browser (WP-705) are `locals.admin` and
 * `locals.participant`; an admin handler reads `admin` only, so `participant` is optional.
 */
export type Call = Pick<RequestEvent, 'request' | 'params' | 'getClientAddress'> & {
  readonly locals: Pick<App.Locals, 'admin'> & Partial<Pick<App.Locals, 'participant'>>;
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** The request body as JSON, or a 400 response. */
export async function readJson(request: Request): Promise<{ value: unknown } | { response: Response }> {
  try {
    return { value: (await request.json()) as unknown };
  } catch {
    return { response: json({ error: 'The request body must be JSON.' }, 400) };
  }
}

export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
