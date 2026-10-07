/**
 * `GET | POST /api/p/<project>/tools/<tool>` and `POST /api/p/<project>/tools/<tool>/read` (B-020, WP-682): the
 * per-tool message stream, the Projekt-Chat first (`tool = chat`).
 *
 * - GET `?after=<seq>&limit=<n>`: `{ messages, head, read, members }` after `after`, oldest first (default limit 200, at most 500);
 *   `head` is the stream's highest seq, `read` the caller's marks, `members` the people who have the tool, `{id, name}`
 *   only, in name order (the person picker; same access rule as the route).
 * - POST `{ id, body }`: idempotent by the client's `id` (a replay answers 200 with the stored message, a new one 201).
 *   `body` is 1 to 4000 characters. Mentions are re-extracted from it (`@ueberblick/core/mentions`); unknown ids are
 *   left out of the index and stay in the text. A new message rings the doorbell as `event: tool` with the key only.
 * - POST `/read` `{ last_read_seq, last_mention_seq? }`: both marks only grow and never pass the head.
 *
 * Access: a participant of the project with a role that has the tool (offered or active) in the deployed config. Any
 * other caller, an unknown tool or no deployed config is 404, as for a pack file (never 403). A malformed query or
 * body is 400 (`invalid_query`, `invalid_body`).
 */
import { MENTION_BODY_MAX, type Clock, type ToolProfileFile } from '@ueberblick/core';
import { z } from '@ueberblick/core/zod';
import type { Db } from '../../db/driver';
import { authorizeProject, DEVICE_KINDS } from '../../http/shared/access';
import { readBody } from '../../http/shared/body';
import type { Handler, ProjectAccessDeps, ProjectCaller } from '../../http/shared/contract';
import { errorResponse, jsonResponse } from '../../http/shared/errors';
import type { DeployedConfig } from '../../sync';
import { roleHasTool, toolMembers } from './access';
import { STREAM_TOOLS } from './registry';
import { IdTaken, createChatStore, type ChatStore } from './store';

export interface ChatDeps extends ProjectAccessDeps {
  readonly clock: Clock;
  projectDb(key: string): Db;
  deployed(key: string): DeployedConfig | undefined;
  /** Rings the doorbell of a project with `event: tool` and the tool key, nothing else (H5). */
  ringTool(projectKey: string, tool: string): void;
}

type Params = { readonly project: string; readonly tool: string };

export interface ChatHandlers {
  readonly list: Handler<Params>;
  readonly send: Handler<Params>;
  readonly read: Handler<Params>;
}

export const DEFAULT_PAGE = 200;
export const MAX_PAGE = 500;
const MAX_BODY_BYTES = 32 * 1024;

const ClientId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'must be 8 to 64 letters, digits or hyphens');
const SendBody = z.strictObject({
  id: ClientId,
  body: z
    .string()
    .refine((s) => s.trim() !== '', 'must not be empty')
    .refine((s) => s.length <= MENTION_BODY_MAX, `must be at most ${MENTION_BODY_MAX} characters`),
});
const Seq = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ReadBody = z.strictObject({ last_read_seq: Seq, last_mention_seq: Seq.optional() });

const notFound = (): Response => errorResponse('not_found', 'No such tool.');
const NUMBER = /^\d{1,15}$/;

export function createChatHandlers(deps: ChatDeps): ChatHandlers {
  const stores = new Map<string, ChatStore>();
  const storeOf = (key: string): ChatStore => {
    let s = stores.get(key);
    if (s === undefined) stores.set(key, (s = createChatStore(deps.projectDb(key), deps.clock)));
    return s;
  };

  /** The caller and the store, or the response to send: everything but a member of the tool's audience is 404. */
  function member(
    req: Request,
    params: Params,
  ): { caller: ProjectCaller; store: ChatStore; file: ToolProfileFile | undefined } | Response {
    const caller = authorizeProject(deps, req, params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller.status === 401 ? caller : notFound();
    if (!STREAM_TOOLS.has(params.tool) || caller.principal.kind !== 'participant') return notFound();
    const file = deps.deployed(caller.project.key)?.config.file;
    if (!roleHasTool(file, caller.actor.roles, params.tool)) return notFound();
    return { caller, store: storeOf(caller.project.key), file };
  }

  const list: ChatHandlers['list'] = async (req, ctx) => {
    const m = member(req, ctx.params);
    if (m instanceof Response) return m;
    const q = new URL(req.url).searchParams;
    for (const k of q.keys())
      if (k !== 'after' && k !== 'limit') return errorResponse('invalid_query', `Unknown parameter "${k}".`);
    const after = q.get('after') ?? '0';
    const limit = q.get('limit') ?? String(DEFAULT_PAGE);
    if (!NUMBER.test(after) || !NUMBER.test(limit) || Number(limit) < 1 || Number(limit) > MAX_PAGE)
      return errorResponse('invalid_query', `"after" is a seq, "limit" is 1 to ${MAX_PAGE}.`);
    const { store, caller, file } = m;
    const tool = ctx.params.tool;
    return jsonResponse({
      messages: store.list(tool, Number(after), Number(limit)),
      head: store.head(tool),
      read: store.readState(caller.actor.id, tool),
      members: toolMembers(file, tool, store.participants()),
    });
  };

  const send: ChatHandlers['send'] = async (req, ctx) => {
    const m = member(req, ctx.params);
    if (m instanceof Response) return m;
    const body = await readBody(req, SendBody, MAX_BODY_BYTES);
    if (body instanceof Response) return body;
    const tool = ctx.params.tool;
    try {
      const { message, created } = m.store.append(tool, m.caller.actor.id, body.id, body.body);
      if (created) deps.ringTool(m.caller.project.key, tool);
      return jsonResponse({ message }, created ? 201 : 200);
    } catch (e) {
      if (e instanceof IdTaken) return errorResponse('conflict', e.message);
      throw e;
    }
  };

  const read: ChatHandlers['read'] = async (req, ctx) => {
    const m = member(req, ctx.params);
    if (m instanceof Response) return m;
    const body = await readBody(req, ReadBody, 1024);
    if (body instanceof Response) return body;
    const state = m.store.markRead(
      m.caller.actor.id,
      ctx.params.tool,
      body.last_read_seq,
      body.last_mention_seq ?? 0,
    );
    return jsonResponse({ read: state });
  };

  return { list, send, read };
}
