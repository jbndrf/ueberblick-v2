import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOL_SCHEMAS, toolAvailabilityFor, type ToolProfileFile } from './tool-options';

const file: ToolProfileFile = {
  tools: { chat: {}, measure: {} },
  roles: {
    offers: { app: { tools: { chat: { availability: 'offered' } } } },
    active: { app: { tools: { chat: { availability: 'active' } } } },
    bare: { app: { tools: { chat: {} } } },
    other: { app: { tools: { measure: {} } } },
    open: { app: {} },
    noapp: {},
  },
};

describe('toolAvailabilityFor (one rule for server, shell and entries)', () => {
  it('a listed tool has its availability; no availability means active', () => {
    expect(toolAvailabilityFor(file, ['offers'], 'chat')).toBe('offered');
    expect(toolAvailabilityFor(file, ['active'], 'chat')).toBe('active');
    expect(toolAvailabilityFor(file, ['bare'], 'chat')).toBe('active');
  });

  it('a role that lists tools without this one does not have it', () => {
    expect(toolAvailabilityFor(file, ['other'], 'chat')).toBeUndefined();
  });

  it('a role without app.tools (or without app, or unknown to the file) gets the project tools, active', () => {
    for (const r of ['open', 'noapp', 'ghost']) {
      expect(toolAvailabilityFor(file, [r], 'chat')).toBe('active');
      expect(toolAvailabilityFor(file, [r], 'search')).toBeUndefined(); // not a project tool
    }
  });

  it("a tool the project does not declare is nobody's, even when a role lists it", () => {
    expect(toolAvailabilityFor({ ...file, tools: {} }, ['active'], 'chat')).toBeUndefined();
    expect(toolAvailabilityFor({}, ['open'], 'chat')).toBeUndefined();
  });

  it('several roles: active beats offered, any role with the tool is enough, none is nothing', () => {
    expect(toolAvailabilityFor(file, ['offers', 'active'], 'chat')).toBe('active');
    expect(toolAvailabilityFor(file, ['other', 'offers'], 'chat')).toBe('offered');
    expect(toolAvailabilityFor(file, ['other'], 'chat')).toBeUndefined();
    expect(toolAvailabilityFor(file, [], 'chat')).toBeUndefined();
  });
});

describe('BUILTIN_TOOL_SCHEMAS', () => {
  it('chat is a built-in tool with no settings: availability per role replaces v3 chat_visible_to_roles', () => {
    expect(BUILTIN_TOOL_SCHEMAS.chat).toEqual({});
  });
});
