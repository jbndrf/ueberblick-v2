/**
 * The MCP server as a function: one JSON-RPC 2.0 message in, the response out (MCP over HTTP with JSON
 * responses; a stdio adapter would call the same `handle`). Only `initialize`, `ping`, `tools/list`
 * and `tools/call` exist; everything else is "method not found". Tool input is validated by the tool's
 * zod schema before it runs; a refusal or an invalid input is a tool result with `isError`, which the
 * assistant reads and corrects, not a protocol error.
 */
import { z } from '@ueberblick/core/zod';
import { defaultTools } from './tools';
import type { AnyTool, JsonRpcResponse, McpServer, ToolContext } from './contract';

export const PROTOCOL_VERSION = '2025-03-26';

const RPC = { parse: -32700, invalid: -32600, method: -32601, params: -32602 } as const;

const Message = z.looseObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
const CallParams = z.looseObject({ name: z.string(), arguments: z.unknown().optional() });

const reply = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});
const failure = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});
const text = (value: unknown, isError: boolean) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

export function createMcpServer(ctx: ToolContext, tools: readonly AnyTool[] = defaultTools): McpServer {
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function callTool(id: string | number, params: unknown): Promise<JsonRpcResponse> {
    const p = CallParams.safeParse(params);
    if (!p.success) return failure(id, RPC.params, 'tools/call needs a tool name.');
    const tool = byName.get(p.data.name);
    if (tool === undefined) return failure(id, RPC.params, `Unknown tool ${p.data.name}.`);
    const input = tool.input.safeParse(p.data.arguments ?? {});
    if (!input.success)
      return reply(
        id,
        text(
          {
            code: 'invalid_input',
            message: `The input of ${tool.name} does not fit its schema.`,
            issues: input.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`),
          },
          true,
        ),
      );
    const r = await tool.run(input.data as never, ctx);
    return reply(id, text(r.value, r.error === true));
  }

  return {
    async handle(message) {
      if (Array.isArray(message))
        return failure(null, RPC.invalid, 'Batches are not supported; send one message.');
      const m = Message.safeParse(message);
      if (!m.success) return failure(null, RPC.invalid, 'Not a JSON-RPC 2.0 request.');
      const { id, method, params } = m.data;
      if (id === undefined) return null; // a notification (`notifications/initialized`, …): no answer
      switch (method) {
        case 'initialize':
          return reply(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'ueberblick-builder', version: '1' },
            instructions:
              'Read the project file, propose ops, simulate them; a human confirms before apply. Nothing you propose is stored until then.',
          });
        case 'ping':
          return reply(id, {});
        case 'tools/list':
          return reply(id, {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: z.toJSONSchema(t.input, {
                target: 'draft-7',
                io: 'input',
                unrepresentable: 'any',
              }),
              annotations: { readOnlyHint: !t.writes },
            })),
          });
        case 'tools/call':
          return callTool(id, params);
        default:
          return failure(id, RPC.method, `Unknown method ${method}.`);
      }
    },
  };
}

export { RPC as JSON_RPC_ERRORS };
