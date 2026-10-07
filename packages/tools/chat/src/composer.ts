// The composer (v3 `Composer.svelte`): a person picker, the message box and the send button. It keeps the draft
// itself; the tool only gives it what to do with a send. The picker is a native select, so a phone shows its own list.
import { appendSeed, bodyOf, insertPerson, isSendKey } from './compose';
import type { Translate } from './messages';

export interface ChatPerson {
  readonly id: string;
  readonly name: string;
}

export interface ComposerDeps {
  readonly t: Translate;
  readonly people: () => readonly ChatPerson[];
  /** Stores the message for sending; rejects when the device cannot keep it (the draft then stays). */
  readonly send: (body: string) => Promise<unknown>;
}

export interface Composer {
  readonly element: HTMLElement;
  /** A one-shot text appended to the draft (not sent); the box takes the focus. */
  seed(text: string): void;
  /** Rebuilds the person list (a new author may have appeared); not while the list is open. */
  refreshPeople(): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const sendIcon = (): SVGElement => {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({
    width: '18',
    height: '18',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, v);
  for (const d of [
    'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
    'm21.854 2.147-10.94 10.939',
  ]) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
};

export function createComposer(deps: ComposerDeps): Composer {
  const { t } = deps;
  const form = document.createElement('form');
  form.className = 'ub-chat-composer';
  form.dataset['chat'] = 'composer';

  const picker = document.createElement('select');
  picker.setAttribute('aria-label', t('mention_label'));
  const box = document.createElement('textarea');
  box.rows = 1;
  box.placeholder = t('placeholder');
  box.setAttribute('aria-label', t('composer_label'));
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'ub-chat-send';
  send.setAttribute('aria-label', t('send'));
  send.append(sendIcon());
  const error = document.createElement('p');
  error.className = 'ub-chat-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.append(picker, box, send, error);

  let submitting = false;
  const syncSend = (): void => {
    send.disabled = submitting || bodyOf(box.value) === '';
  };

  function refreshPeople(): void {
    if (document.activeElement === picker) return; // a native list closes when its options change
    const people = deps.people();
    picker.replaceChildren();
    const first = document.createElement('option');
    first.value = '';
    first.textContent = people.length === 0 ? t('mention_empty') : t('mention_label');
    picker.append(first);
    for (const p of people) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      picker.append(o);
    }
    picker.disabled = people.length === 0;
  }

  const place = (value: string, caret: number): void => {
    box.value = value;
    box.focus();
    box.setSelectionRange(caret, caret);
    syncSend();
  };

  picker.addEventListener('change', () => {
    const id = picker.value;
    picker.value = '';
    if (id === '') return;
    const edit = insertPerson(box.value, box.selectionStart ?? box.value.length, id);
    place(edit.value, edit.caret);
  });
  box.addEventListener('input', () => {
    error.hidden = true;
    syncSend();
  });
  async function submit(): Promise<void> {
    const body = bodyOf(box.value);
    if (body === '' || submitting) return;
    submitting = true;
    syncSend();
    try {
      await deps.send(body);
      box.value = '';
      error.hidden = true;
    } catch {
      error.textContent = t('failed'); // the draft stays
      error.hidden = false;
    } finally {
      submitting = false;
      syncSend();
    }
  }
  box.addEventListener('keydown', (e) => {
    if (!isSendKey(e)) return;
    e.preventDefault();
    void submit();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });

  refreshPeople();
  syncSend();
  return {
    element: form,
    seed(text) {
      const edit = appendSeed(box.value, text);
      place(edit.value, edit.caret);
    },
    refreshPeople,
  };
}
