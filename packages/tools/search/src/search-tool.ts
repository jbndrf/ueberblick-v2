// The search tool (WP-552): a `toolbar` tool that only reads. A keystroke asks the store's text index (never a
// scan), a tap on a result centres the map and opens the feature sheet. It writes nothing (R3).
import type { Geo } from '@ueberblick/core/geo';
import type { Key } from '@ueberblick/core/model';
import { BUILTIN_TOOL_SCHEMAS } from '@ueberblick/core/registry/tools';
import {
  defineTool,
  type PanelTool,
  type PanelToolContext,
  type ToolHandle,
  type ToolTextSource,
} from '@ueberblick/ui/tool-api';
import { message, type SearchMessageKey } from './messages';
import { centreOf, searchFeatures, type SearchResult } from './model';

/** Results shown per keystroke; the index is asked for one more to tell whether there are others. */
export const RESULT_LIMIT = 20;

let mounted = 0;

const STYLE = `
.ub-search{display:flex;flex-direction:column;gap:var(--ub-space-sm,8px)}
.ub-search-input{box-sizing:border-box;width:100%;min-height:56px;padding:0 var(--ub-space-md,16px);font:inherit;color:var(--ub-color-text,#111);background:var(--ub-color-bg,#fff);border:2px solid var(--ub-color-border,#767676);border-radius:var(--ub-radius-md,8px)}
.ub-search-input:focus-visible,.ub-search-item:focus-visible{outline:3px solid var(--ub-color-focus,#005fcc);outline-offset:2px}
.ub-search-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--ub-space-xs,4px)}
.ub-search-item{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:56px;padding:var(--ub-space-sm,8px) var(--ub-space-md,16px);font:inherit;text-align:start;color:var(--ub-color-text,#111);background:var(--ub-color-bg,#fff);border:2px solid var(--ub-color-border,#767676);border-radius:var(--ub-radius-md,8px);cursor:pointer}
.ub-search-item-label{font-weight:var(--ub-type-weight-strong,600)}
.ub-search-item-type{font-size:var(--ub-type-size-sm,14px);color:var(--ub-color-text-muted,#555)}
.ub-search-note{margin:0;font-size:var(--ub-type-size-sm,14px);color:var(--ub-color-text-muted,#555)}
.ub-search-note[data-error]{color:var(--ub-color-danger,#b00020);font-weight:var(--ub-type-weight-strong,600)}
`;

function mountSearch(
  root: HTMLElement,
  ctx: PanelToolContext,
  deps: { geo: Geo; sources: readonly ToolTextSource[]; primaryGeometry: PrimaryGeometry },
): ToolHandle {
  const t = (k: SearchMessageKey, v?: Record<string, string | number>) => message(ctx.locale, k, v);
  const wrap = document.createElement('div');
  wrap.className = 'ub-search';
  const style = document.createElement('style');
  style.textContent = STYLE;
  const label = document.createElement('label');
  label.textContent = t('label');
  label.className = 'ub-search-note';
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'ub-search-input';
  input.placeholder = t('placeholder');
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  input.id = `ub-search-${++mounted}`;
  label.htmlFor = input.id;
  const status = document.createElement('p');
  status.className = 'ub-search-note';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = document.createElement('ul');
  list.className = 'ub-search-list';

  let shown: readonly SearchResult[] = [];

  function say(text: string, error = false): void {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
  }

  function open(result: SearchResult): void {
    const state = ctx.feature(result.id);
    const at = state ? centreOf(deps.geo, state, deps.primaryGeometry(state.type)) : undefined;
    if (at) ctx.map.centerOn(at);
    ctx.openFeature(result.id);
    if (!at) say(t('noPosition'));
  }

  function render(query: string): void {
    list.replaceChildren();
    shown = [];
    if (deps.sources.length === 0) return say(t('noSources'), true);
    if (query.trim() === '') return say('');
    try {
      shown = searchFeatures(ctx, deps.sources, query, RESULT_LIMIT + 1);
    } catch {
      return say(t('notReady'), true);
    }
    const visible = shown.slice(0, RESULT_LIMIT);
    for (const r of visible) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ub-search-item';
      const main = document.createElement('span');
      main.className = 'ub-search-item-label';
      main.textContent = r.label;
      const sub = document.createElement('span');
      sub.className = 'ub-search-item-type';
      sub.textContent = ctx.typeLabel(r.type);
      b.setAttribute('aria-label', `${r.label}, ${sub.textContent}`);
      b.append(main, sub);
      b.addEventListener('click', () => open(r));
      li.append(b);
      list.append(li);
    }
    if (visible.length === 0) return say(t('none', { query: query.trim() }));
    say(shown.length > RESULT_LIMIT ? t('more', { n: RESULT_LIMIT }) : t('count', { n: visible.length }));
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = shown[0];
      if (first) open(first);
    } else if (e.key === 'Escape' && input.value !== '') {
      input.value = '';
      render('');
    } else if (e.key === 'ArrowDown') {
      list.querySelector<HTMLButtonElement>('button')?.focus();
      e.preventDefault();
    }
  });
  list.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    if (e.key === 'ArrowDown') items[at + 1]?.focus();
    else if (e.key === 'ArrowUp') (at === 0 ? input : items[at - 1])?.focus();
    else return;
    e.preventDefault();
  });

  render('');
  wrap.append(style, label, input, status, list);
  root.append(wrap);
  return { destroy: () => wrap.remove() };
}

/** The declared primary geometry property of a feature type (`FoldType.primaryGeometry`), if any. */
export type PrimaryGeometry = (type: Key) => Key | undefined;

export function createSearchTool(deps: {
  readonly geo: Geo;
  readonly primaryGeometry: PrimaryGeometry;
  /** The view's `tools.search.sources`; the app has registered each with the store's `indexText`. */
  readonly sources: readonly ToolTextSource[];
}): PanelTool {
  return defineTool({
    key: 'search',
    contributes: ['tools-sheet'],
    settings: BUILTIN_TOOL_SCHEMAS.search.settings,
    mount: (root, ctx) => mountSearch(root, ctx, deps),
  });
}
