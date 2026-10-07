// One group of the thread as DOM (v3 `MessageList.svelte:253-282`): the header line, the bubbles, and the state of a
// send that has not reached the server. Every text goes in through `textContent`; a body never becomes markup.
import type { ToolDataItem } from '@ueberblick/ui/tool-api';
import { bodySegments } from './body';
import type { Translate } from './messages';
import { shortId } from '@ueberblick/core';
import { timeLabel, type ThreadGroup } from './thread';

export interface ViewDeps {
  readonly self: string;
  readonly locale: string;
  readonly t: Translate;
  readonly nameOf: (personId: string) => string | undefined;
  readonly featureLabel: (featureId: string) => string | undefined;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  data: Record<string, string> = {},
) => {
  const node = document.createElement(tag);
  node.className = cls;
  for (const [k, v] of Object.entries(data)) node.dataset[k] = v;
  return node;
};

function bubble(item: ToolDataItem, deps: ViewDeps): HTMLElement {
  const node = el('div', 'ub-chat-bubble', { chat: 'bubble', id: item.id });
  for (const seg of bodySegments(item.body, deps.self)) {
    if (seg.kind === 'text') {
      const span = el('span', 'ub-chat-text');
      span.textContent = seg.text;
      node.append(span);
    } else if (seg.kind === 'person') {
      const chip = el('span', 'ub-chat-chip', { chat: 'chip', kind: 'person', me: String(seg.me) });
      chip.textContent = `@${deps.nameOf(seg.id) ?? shortId(seg.id).slice(1)}`;
      node.append(chip);
    } else {
      const chip = el('button', 'ub-chat-chip', { chat: 'chip', kind: 'feature', id: seg.id });
      chip.type = 'button';
      const label = deps.featureLabel(seg.id);
      chip.textContent = label === undefined ? shortId(seg.id) : `#${label}`;
      node.append(chip);
    }
  }
  return node;
}

/** What a send says about itself: nothing once the server has it, "wird gesendet" while it waits, the reason when refused. */
function state(item: ToolDataItem, deps: ViewDeps): HTMLElement | undefined {
  if (item.seq !== null) return undefined;
  if (item.refusal === undefined) {
    const pending = el('div', 'ub-chat-state', { chat: 'pending' });
    pending.textContent = deps.t('pending');
    return pending;
  }
  const refused = el('div', 'ub-chat-state ub-chat-refused', { chat: 'refused', id: item.id });
  const why = el('span', '');
  why.textContent = deps.t('refused', { reason: item.refusal.reason });
  const retry = el('button', '', { action: 'retry', id: item.id });
  retry.type = 'button';
  retry.textContent = deps.t('refused_retry');
  const discard = el('button', '', { action: 'discard', id: item.id });
  discard.type = 'button';
  discard.textContent = deps.t('refused_discard');
  refused.append(why, retry, discard);
  return refused;
}

export function renderGroup(group: ThreadGroup, deps: ViewDeps): HTMLElement {
  const node = el('div', 'ub-chat-group', { chat: 'group', key: group.key, mine: String(group.mine) });
  const name = group.mine ? deps.t('you') : (deps.nameOf(group.author) ?? deps.t('unknown'));
  const head = el('div', 'ub-chat-head', { chat: 'head' });
  head.textContent = `${name} · ${timeLabel(group.at, deps.locale)}`;
  node.append(head);
  for (const item of group.items) {
    node.append(bubble(item, deps));
    const s = state(item, deps);
    if (s !== undefined) node.append(s);
  }
  return node;
}
