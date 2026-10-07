// The Projekt-Chat tool (B-020, WP-684): v3's chat panel body over `ctx.data` (WP-683). The tool never calls the
// network: the device mirrors the stream, keeps a send in its outbox and rings when there is news. Names and feature
// labels are read from what is on the device (`ChatDeps`), so an unknown id shows as a short id, as in v3.
import type { FeatureId, Seq } from '@ueberblick/core/model';
import {
  defineTool,
  type PanelTool,
  type PanelToolContext,
  type ToolDataItem,
  type ToolDataPort,
  type ToolHandle,
} from '@ueberblick/ui/tool-api';
import { createComposer, type ChatPerson } from './composer';
import { createThreadList } from './list';
import { translator } from './messages';
import { STYLE } from './style';
import { renderGroup, type ViewDeps } from './thread-view';

export type { ChatPerson } from './composer';

/** "Im Chat erwähnen" hands the panel a text once; it may arrive before the panel is open or while it is. */
export interface ChatSeed {
  /** The waiting seed, once. */
  take(): string | undefined;
  /** Calls `fn` when a seed arrives while the panel is open. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

export interface ChatDeps {
  /** The signed-in person's id: the author of the reader's own messages. */
  readonly self: () => string;
  /** A person's name from what the device holds; undefined when it has none (the chip shows a short id). */
  readonly nameOf: (personId: string) => string | undefined;
  /** The people the picker offers: those on the device who have the chat. */
  readonly people: () => readonly ChatPerson[];
  /** A feature's label from what the device holds; undefined when it is not there. */
  readonly featureLabel: (featureId: string) => string | undefined;
  readonly seed: ChatSeed;
}

/** The highest server seq in the list; pending and refused sends have none. */
function newestSeq(items: readonly ToolDataItem[]): Seq {
  for (let i = items.length - 1; i >= 0; i--) {
    const seq = (items[i] as ToolDataItem).seq;
    if (seq !== null) return seq;
  }
  return 0 as Seq;
}

function mountChat(root: HTMLElement, ctx: PanelToolContext, deps: ChatDeps): ToolHandle {
  const data = ctx.data;
  if (data !== undefined) return mountStream(root, ctx, deps, data);
  // The role has no chat (or lost it while the panel was open).
  const note = document.createElement('p');
  note.className = 'ub-chat-note';
  note.textContent = translator(ctx.locale)('not_member');
  root.replaceChildren(note);
  return { destroy: () => root.replaceChildren() };
}

function mountStream(
  root: HTMLElement,
  ctx: PanelToolContext,
  deps: ChatDeps,
  data: ToolDataPort,
): ToolHandle {
  const t = translator(ctx.locale);
  const style = document.createElement('style');
  style.textContent = STYLE;
  const wrap = document.createElement('div');
  wrap.className = 'ub-chat';
  root.append(style, wrap);

  const view: ViewDeps = {
    self: deps.self(),
    locale: ctx.locale,
    t,
    nameOf: deps.nameOf,
    featureLabel: deps.featureLabel,
  };
  const log = document.createElement('div');
  log.className = 'ub-chat-log';
  log.dataset['chat'] = 'log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', t('list_label'));
  log.tabIndex = 0;
  const composer = createComposer({ t, people: deps.people, send: (body) => data.append(body) });
  wrap.append(log, composer.element);

  const list = createThreadList(log, view.self, (g) => renderGroup(g, view), t('empty'));
  // A # chip opens the feature; the panel stays (v3 `instance-reference-open`: the handler did not close the chat).
  log.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const chip = target?.closest<HTMLElement>('button[data-chat="chip"][data-kind="feature"]');
    if (chip?.dataset['id'] !== undefined) return ctx.openFeature(chip.dataset['id'] as FeatureId);
    const action = target?.closest<HTMLElement>('button[data-action]');
    const id = action?.dataset['id'];
    if (id === undefined) return;
    if (action?.dataset['action'] === 'retry') void data.retry(id);
    else void data.discard(id);
  });

  let marked = data.cursor.lastReadSeq;
  let lastId: string | undefined;
  function refresh(): void {
    const items = data.items();
    const newest = items[items.length - 1];
    // the reader's own message always shows: they just wrote it
    const follow = newest !== undefined && newest.id !== lastId && newest.author === view.self;
    lastId = newest?.id;
    list.update(items, follow);
    composer.refreshPeople();
    // Reading clears both badges, once per open and once per new batch (v3 wrote per message).
    const seq = newestSeq(items);
    if (seq > marked) {
      marked = seq;
      data.markRead(seq);
    }
  }
  const stops = [data.subscribe(refresh), deps.seed.subscribe(takeSeed)];
  function takeSeed(): void {
    const s = deps.seed.take();
    if (s !== undefined) composer.seed(s);
  }
  refresh();
  takeSeed();
  let alive = true;
  return {
    destroy() {
      if (!alive) return;
      alive = false;
      stops.forEach((s) => s());
      list.destroy();
      root.replaceChildren();
    },
  };
}

/** The chat as a tool of the Werkzeuge sheet with a data stream (`ctx.data`). */
export function createChatTool(deps: ChatDeps): PanelTool {
  return defineTool({
    key: 'chat',
    contributes: ['tools-sheet'],
    data: true,
    mount: (el, ctx) => mountChat(el, ctx, deps),
  });
}
