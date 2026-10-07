/**
 * HTTP for the pull protocol (docs/07). Framework-free: a handler takes a Web `Request` and answers a Web `Response`,
 * so `apps/web` mounts each in one line and the tests call them directly.
 *
 * - `sync(call)`: `GET /api/p/<project>/sync?since&scope&v[&after&pin&limit]` answers one page as tuples in a gzip stream.
 * - `events(call)`: `GET /api/p/<project>/sync/events` is the SSE doorbell: `event: seq` with `{from,to,head}` per
 *   committed seq range, `event: hello` with the head on connect, a comment heartbeat, nothing else (H5).
 * - Who may call: a participant of that project, or an admin with a role in it. Anything else is 401 / 403 / 404.
 */
import { decodeRequest, encodePage, SyncProtocolError, type Actor, type Key } from '@ueberblick/core';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../../auth';
import type { Logger } from '../../log';
import { SyncUnavailable, type Doorbell, type SyncService } from '../../sync';
import { toolEvent, type ToolBell } from '../../modules/chat/tool-bell';
import { sessionChanged, withParticipant } from '../shared/session-participant';
import { acceptsGzip, pageResponse } from './gzip';

export interface SyncCall {
  readonly request: Request;
  readonly project: string;
  /** The participant session (or API token) of the request: tried first, like every device endpoint (`DEVICE_KINDS`). */
  readonly principal: Principal | null;
  /** The admin session of the same browser (WP-705), the fallback, e.g. an admin watching the builder preview. */
  readonly fallback?: Principal | null;
}

export interface SyncHttpDeps {
  /** The process logger (`sync.served`). Required: a handler without one would be silent (R11). */
  readonly log: Logger;
  project(key: string): { readonly id: string; readonly key: string } | undefined;
  /** Roles of an admin account in a project (`Auth.rolesFor`). */
  rolesFor(accountId: string, projectId: string): readonly Key[];
  service(projectKey: string): SyncService;
  doorbell(projectKey: string): Doorbell;
  /** The tool bell: a ring is written as `event: tool` with the key only (H5, docs/07). */
  readonly toolBell: ToolBell;
  /** Comment line sent on an idle event stream; keeps proxies from closing it. Default 25 s. */
  readonly heartbeatMs?: number;
}

export interface SyncHandlers {
  sync(call: SyncCall): Response;
  events(call: SyncCall): Response;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export function createSyncHandlers(deps: SyncHttpDeps): SyncHandlers {
  function authorizeOne(call: SyncCall, principal: Principal | null): Actor | Response {
    if (principal === null) return json({ error: 'Sign in first.' }, 401);
    const project = deps.project(call.project);
    if (!project) return json({ error: `Unknown project ${call.project}.` }, 404);
    if (principal.kind === 'participant') {
      if (principal.projectId !== project.id) return json({ error: 'No access to this project.' }, 403);
      return { id: principal.id, kind: principal.kind, roles: principal.roles };
    }
    const roles = principal.kind === 'admin' ? deps.rolesFor(principal.id, project.id) : [];
    if (roles.length === 0) return json({ error: 'No access to this project.' }, 403);
    return { id: principal.id, kind: principal.kind, roles };
  }

  /** The first session that may act wins (participant, then admin); else the most telling refusal (non-401 first). */
  function authorize(call: SyncCall): Actor | Response {
    let refusal: Response | null = null;
    for (const principal of [call.principal, call.fallback ?? null]) {
      const answer = authorizeOne(call, principal);
      if (!(answer instanceof Response)) return answer;
      if (refusal === null || (refusal.status === 401 && answer.status !== 401)) refusal = answer;
    }
    return refusal ?? json({ error: 'Sign in first.' }, 401);
  }

  return {
    sync(call) {
      const actor = authorize(call);
      if (actor instanceof Response) return actor;
      const foreign = sessionChanged(call.request, actor.id);
      if (foreign !== null) return foreign;
      const t0 = performance.now();
      try {
        const query = Object.fromEntries(new URL(call.request.url).searchParams);
        const page = deps.service(call.project).page(actor, decodeRequest(query));
        const response = withParticipant(pageResponse(encodePage(page), acceptsGzip(call.request)), actor.id);
        deps.log.log('sync.served', {
          requestId: randomUUID(),
          actor: actor.id,
          tuples:
            page.features.length + page.edges.length + page.observations.length + page.tombstones.length,
          ms: performance.now() - t0,
        });
        return response;
      } catch (e) {
        if (e instanceof SyncProtocolError)
          return json({ code: e.code, error: e.message }, e.code === 'version_mismatch' ? 409 : 400);
        if (e instanceof SyncUnavailable) return json({ code: 'no_config', error: e.message }, 409);
        throw e;
      }
    },

    events(call) {
      const actor = authorize(call);
      if (actor instanceof Response) return actor;
      const bell = deps.doorbell(call.project);
      const encoder = new TextEncoder();
      const heartbeat = deps.heartbeatMs ?? 25_000;
      let stop: (() => void) | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (text: string): void => {
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              stop?.(); // the stream is closed already
            }
          };
          const off = bell.subscribe((m) => send(`event: seq\ndata: ${JSON.stringify(m)}\n\n`));
          const offTool = deps.toolBell.subscribe(call.project, (tool) => send(toolEvent(tool)));
          const timer = setInterval(() => send(': heartbeat\n\n'), heartbeat);
          timer.unref();
          stop = () => {
            off();
            offTool();
            clearInterval(timer);
            call.request.signal.removeEventListener('abort', close);
          };
          const close = (): void => {
            stop?.();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };
          if (call.request.signal.aborted) return close(); // an abort event that already fired never comes again
          call.request.signal.addEventListener('abort', close);
          send(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ head: bell.head() })}\n\n`);
        },
        cancel() {
          stop?.();
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        },
      });
    },
  };
}
