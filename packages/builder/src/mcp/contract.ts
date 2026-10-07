/**
 * The assistant tool surface (H4, WP-211). Headless: no DOM, no I/O. The MCP transport (JSON-RPC over
 * HTTP, `apps/web/src/routes/api/mcp`) and any other adapter call `createMcpServer`; nothing here knows
 * a tool by name. Authority (O15): tools read and propose; `apply` is the only write and needs a
 * confirmation token that only a human step issues (`issueConfirmation`).
 */
import type { ZodType } from 'zod';

/** The project's working draft as the builder opens it (A-011); `revision` is the store's counter. */
export interface DraftRead {
  readonly templateSrc: string;
  readonly overlaySrc: string;
  readonly revision: number;
}

export type DraftReadResult =
  | { readonly ok: true; readonly draft: DraftRead }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** What a draft write answers: the same words as `PUT /builder-api/<project>/draft`. */
export type DraftWriteResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly code: 'stale_revision'; readonly currentRevision: number }
  | { readonly ok: false; readonly code: 'write_refused'; readonly status: number; readonly message: string };

/** The one path to the draft (GET / PUT with revision compare-and-swap); the app implements it. */
export interface DraftPort {
  read(): Promise<DraftReadResult>;
  write(overlay: string, revision: number): Promise<DraftWriteResult>;
}

/** Signs and tells the time: injected, so the tools stay pure and testable. */
export interface ConfirmationPort {
  /** A keyed signature (HMAC) of `message`, as text. */
  sign(message: string): string;
  /** Milliseconds since the epoch. */
  now(): number;
  /** How long a token is valid, in milliseconds. */
  readonly ttlMs: number;
}

export interface ToolContext {
  readonly project: string;
  readonly draft: DraftPort;
  readonly confirmation: ConfirmationPort;
}

/** The result of a tool: JSON for the assistant; `error` marks a refusal it should read and correct. */
export interface ToolResult {
  readonly value: unknown;
  readonly error?: true;
}

export interface McpTool<I = unknown> {
  readonly name: string;
  readonly description: string;
  /** The input, validated before `run` sees it. */
  readonly input: ZodType<I>;
  /** True for a tool that changes stored state (only `apply`). */
  readonly writes: boolean;
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}

/** A tool of any input type, as the registry holds it (the server validates before it runs). */
export interface AnyTool {
  readonly name: string;
  readonly description: string;
  readonly input: ZodType<unknown>;
  readonly writes: boolean;
  run(input: never, ctx: ToolContext): Promise<ToolResult>;
}

export const defineTool = <I>(tool: McpTool<I>): McpTool<I> => tool;

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface McpServer {
  /** One JSON-RPC 2.0 message in, the response out; `null` for a notification (nothing to answer). */
  handle(message: unknown): Promise<JsonRpcResponse | null>;
}
