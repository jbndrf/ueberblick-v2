import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TemplateFile } from '@ueberblick/core/model';
import { TOOL_AVAILABILITY } from '@ueberblick/core/registry';
import { TOOL_MANIFEST } from './manifest';
import {
  groupOf,
  isToolOn,
  sheetTools,
  switchableTools,
  toolEntries,
  TOOL_GROUPS,
  VIEWS_TOOL,
} from './entries';

const file = (tools: Record<string, unknown> | undefined, project: Record<string, unknown> = {}) =>
  ({
    roles: { kontrolle: { label: 'K', app: tools === undefined ? {} : { tools } } },
    tools: { measure: {}, search: {}, photo: {}, ...project },
  }) as unknown as TemplateFile;

const keys = (es: readonly { key: string }[]) => es.map((e) => e.key);

describe('the static tool manifest', () => {
  it('lists Measure, Search and the Projekt-Chat as Werkzeuge entries, Ansichten and Cluster as Karteninhalt tabs, and no field tool', () => {
    expect(keys(TOOL_MANIFEST)).toEqual(['measure', 'search', 'chat', 'views', 'cluster']);
    const tabs = ['views', 'cluster'];
    for (const t of TOOL_MANIFEST.filter((x) => !tabs.includes(x.key)))
      expect(t.contributes).toContain('tools-sheet');
    for (const k of tabs) expect(TOOL_MANIFEST.find((x) => x.key === k)?.contributes).toEqual(['filter-tab']);
  });
});

describe('toolEntries: offered off, active on, absent never', () => {
  const f = file({ measure: { availability: 'offered' }, search: { availability: 'active' }, photo: {} });

  it('an offered tool is off until the person switches it on', () => {
    const e = toolEntries(f, 'kontrolle', {});
    expect(e.find((x) => x.key === 'measure')).toMatchObject({ availability: 'offered', on: false });
  });
  it('an active tool is on until the person switches it off', () => {
    const e = toolEntries(f, 'kontrolle', {});
    expect(e.find((x) => x.key === 'search')).toMatchObject({ availability: 'active', on: true });
  });
  it("the person's switch wins over the default, both ways", () => {
    const e = toolEntries(f, 'kontrolle', { measure: true, search: false });
    expect(e.find((x) => x.key === 'measure')?.on).toBe(true);
    expect(e.find((x) => x.key === 'search')?.on).toBe(false);
  });
  it('a tool the role does not list does not exist for it', () => {
    const e = toolEntries(file({ search: {} }), 'kontrolle', { measure: true });
    expect(keys(e)).toEqual(['search']);
  });
  it('availability defaults to active; a role with no app tools has the project tools, active', () => {
    expect(toolEntries(file({ search: {} }), 'kontrolle', {})[0]).toMatchObject({
      availability: 'active',
      on: true,
    });
    expect(toolEntries(file(undefined), 'kontrolle', {}).every((x) => x.availability === 'active')).toBe(
      true,
    );
  });
  it('a role the file does not know has the project tools', () => {
    expect(keys(toolEntries(file({ search: {} }), 'nobody', {}))).toEqual(['measure', 'search']);
  });
  it('a tool the app does not host is not an entry', () => {
    expect(
      keys(toolEntries(file({ unbekannt: {}, search: {} }, { unbekannt: {} }), 'kontrolle', {})),
    ).toEqual(['search']);
  });

  it('property: on = the switch when set, else availability is active', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOOL_AVAILABILITY.keys),
        fc.option(fc.boolean(), { nil: undefined }),
        (availability, sw) => {
          const f2 = file({ measure: { availability } });
          const entry = toolEntries(f2, 'kontrolle', sw === undefined ? {} : { measure: sw })[0];
          expect(entry?.on).toBe(sw ?? availability === 'active');
        },
      ),
    );
  });
});

describe('sheetTools and switchableTools', () => {
  const entries = toolEntries(
    file({ measure: { availability: 'offered' }, search: { availability: 'active' } }),
    'kontrolle',
    {},
  );

  it('the Werkzeuge sheet lists tools that are on and contribute tools-sheet', () => {
    expect(keys(sheetTools(entries, []))).toEqual(['search']);
    const on = toolEntries(file({ measure: { availability: 'offered' }, search: {} }), 'kontrolle', {
      measure: true,
    });
    expect(keys(sheetTools(on, []))).toEqual(['measure', 'search']);
  });
  it('a tool with an invalid setting is not offered', () => {
    expect(sheetTools(entries, [{ code: 'tool_setting_invalid', subject: 'search', detail: 'x' }])).toEqual(
      [],
    );
  });
  it('a tool that needs a tappable map is left out while there is none', () => {
    const on = toolEntries(file({ measure: {}, search: {} }), 'kontrolle', {});
    expect(keys(sheetTools(on, [], { map: false }))).toEqual(['search']);
    expect(keys(sheetTools(on, [], { map: true }))).toEqual(['measure', 'search']);
  });
  it('the switches list every offered or active tool, on or off, in manifest order', () => {
    expect(keys(switchableTools(entries))).toEqual(['measure', 'search']);
  });
  it('the switch groups are the contribution points, in v3 order Filter, Layer, Werkzeuge', () => {
    expect(TOOL_GROUPS).toEqual(['filter', 'layers', 'tools']);
    expect(groupOf('filter-tab')).toBe('filter');
    expect(groupOf('layer-section')).toBe('layers');
    expect(groupOf('tools-sheet')).toBe('tools');
    expect(groupOf('form-field')).toBeUndefined();
  });
});

describe('Ansichten (WP-665): v3 `filter.field_filters`', () => {
  const f = (availability?: string) =>
    file({ views: availability === undefined ? {} : { availability } }, { views: {} });
  it('is a tool the person switches in the Filter group, with no tile in Werkzeuge', () => {
    const e = toolEntries(f('offered'), 'kontrolle', {});
    expect(switchableTools(e).map((t) => [t.key, groupOf(t.contributes[0] as never)])).toEqual([
      [VIEWS_TOOL, 'filter'],
    ]);
    expect(sheetTools(toolEntries(f('active'), 'kontrolle', {}), [])).toEqual([]);
  });
  it('is off until the person switches it on when offered, on when active, and the switch wins', () => {
    expect(isToolOn(f('offered'), 'kontrolle', {}, VIEWS_TOOL)).toBe(false);
    expect(isToolOn(f('offered'), 'kontrolle', { views: true }, VIEWS_TOOL)).toBe(true);
    expect(isToolOn(f('active'), 'kontrolle', {}, VIEWS_TOOL)).toBe(true);
    expect(isToolOn(f('active'), 'kontrolle', { views: false }, VIEWS_TOOL)).toBe(false);
  });
  it('does not exist for a role that does not list it, or a project without it', () => {
    expect(isToolOn(file({ search: {} }, { views: {} }), 'kontrolle', { views: true }, VIEWS_TOOL)).toBe(
      false,
    );
    expect(isToolOn(file({}), 'kontrolle', { views: true }, VIEWS_TOOL)).toBe(false);
  });
});

describe("the Projekt-Chat entry (B-020: core's one availability rule)", () => {
  const chatFile = (
    roleTools: Record<string, unknown> | undefined,
    project: Record<string, unknown> = { chat: {} },
  ) =>
    ({
      roles: { kontrolle: { label: 'K', app: roleTools === undefined ? {} : { tools: roleTools } } },
      tools: project,
    }) as unknown as TemplateFile;
  const chat = (f: TemplateFile, switches = {}) =>
    toolEntries(f, 'kontrolle', switches).find((t) => t.key === 'chat');

  it('a role with no app.tools has a declared chat, active, with a Werkzeuge tile', () => {
    const e = chat(chatFile(undefined));
    expect(e).toMatchObject({ availability: 'active', on: true, data: true, aside: true });
    expect(sheetTools(toolEntries(chatFile(undefined), 'kontrolle', {}), []).map((t) => t.key)).toContain(
      'chat',
    );
  });

  it('a role that lists tools without the chat has none: no tile, no menu item', () => {
    expect(chat(chatFile({ measure: {} }))).toBeUndefined();
  });

  it('a project that does not declare the chat has none, whatever the role says', () => {
    expect(chat(chatFile({ chat: {} }, { measure: {} }))).toBeUndefined();
  });

  it('offered is off until the person switches it on, and a person can switch an active chat off', () => {
    const offered = chatFile({ chat: { availability: 'offered' } });
    expect(chat(offered)?.on).toBe(false);
    expect(chat(offered, { chat: true })?.on).toBe(true);
    expect(chat(chatFile({ chat: { availability: 'active' } }), { chat: false })?.on).toBe(false);
  });
});
