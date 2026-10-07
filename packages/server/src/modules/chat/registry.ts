import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** The tools that keep a message stream on the server (`/api/p/<project>/tools/<key>`). A new stream appends here. */
export const STREAM_TOOLS = defineRegistry([
  { key: 'chat', description: 'Projekt-Chat: the project talks about features (B-020).' },
] as const);
export type StreamTool = KeyOf<typeof STREAM_TOOLS>;
