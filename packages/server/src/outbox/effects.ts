/**
 * Effects: what the outbox worker executes after a run committed (e-mail, webhook ...). Each kind is one
 * registry entry with a handler port (F8), so a new effect is one `defineEffect` and no worker change.
 */
export interface EffectContext {
  readonly runId: string;
  /** 1 on the first execution. */
  readonly attempt: number;
}

/** Performs the effect. Throw to signal failure: the worker retries with backoff. Should be idempotent per `runId`. */
export type EffectHandler = (payload: unknown, ctx: EffectContext) => Promise<void>;

export interface EffectEntry<K extends string = string> {
  readonly key: K;
  readonly description: string;
  readonly handler: EffectHandler;
}

export function defineEffect<const K extends string>(entry: EffectEntry<K>): EffectEntry<K> {
  return entry;
}

export type EffectRegistry = ReadonlyMap<string, EffectEntry>;

export function effectRegistry(entries: readonly EffectEntry[]): EffectRegistry {
  const map = new Map<string, EffectEntry>();
  for (const e of entries) {
    if (map.has(e.key)) throw new Error(`duplicate effect kind: ${e.key}`);
    map.set(e.key, e);
  }
  return map;
}

export interface WebhookPayload {
  readonly url: string;
  readonly body: unknown;
}

export type FetchPort = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ readonly ok: boolean; readonly status: number }>;

function isWebhookPayload(p: unknown): p is WebhookPayload {
  return typeof p === 'object' && p !== null && typeof (p as { url?: unknown }).url === 'string';
}

/** POSTs `payload.body` as JSON to `payload.url`. Any non-2xx answer is a failure and is retried. */
export function webhookEffect(fetchPort: FetchPort): EffectEntry<'webhook'> {
  return defineEffect({
    key: 'webhook',
    description: 'POSTs a JSON body to a URL.',
    handler: async (payload, ctx) => {
      if (!isWebhookPayload(payload)) throw new Error('webhook payload needs a url');
      const res = await fetchPort(payload.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': ctx.runId },
        body: JSON.stringify(payload.body ?? null),
      });
      if (!res.ok) throw new Error(`webhook answered ${res.status}`);
    },
  });
}
