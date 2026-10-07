// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import type { FeatureId, Seq } from '@ueberblick/core/model';
import axe from 'axe-core';
import { describeToolContract, testPorts } from '@ueberblick/ui/tool-testing';
import { createChatTool } from './chat-tool';
import { chatDeps, fakeData, layout, mountChat, msg } from './chat.testing';

afterEach(() => document.body.replaceChildren());

/** Violations of an element (jsdom has no layout, so colour contrast is proven from the tokens instead). */
const axeViolations = async (el: Element): Promise<string[]> =>
  (await axe.run(el, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
    (v) => `${v.id}: ${v.help}`,
  );
const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (el === null) throw new Error(`missing ${sel}`);
  return el;
};
const draft = (root: HTMLElement) => q<HTMLTextAreaElement>(root, 'textarea');

describe('message list (v3 MessageList.svelte)', () => {
  it('says "Noch keine Nachrichten. Sag doch hallo!" when there are none', async () => {
    const { root } = await mountChat(fakeData());
    expect(root.textContent).toContain('Noch keine Nachrichten. Sag doch hallo!');
  });

  it('groups by author: one header "Du · …" or "Name · …" per group, own right and others left', async () => {
    const data = fakeData([
      msg(1, 'anna', 'Hallo'),
      msg(2, 'anna', 'noch eins', { at: '2026-10-02T08:10:30.000Z' as never }),
      msg(3, 'me', 'Moin'),
      msg(4, 'zed', 'wer?'),
    ]);
    const { root } = await mountChat(data);
    const groups = [...root.querySelectorAll<HTMLElement>('[data-chat="group"]')];
    expect(groups.map((g) => g.dataset['mine'])).toEqual(['false', 'true', 'false']);
    const heads = groups.map((g) => q(g, '[data-chat="head"]').textContent ?? '');
    expect(heads[0]).toMatch(/^Anna · /);
    expect(heads[1]).toMatch(/^Du · /);
    expect(heads[2]).toMatch(/^Unbekannt · /); // an author the device has no name for
    expect(groups[0]?.querySelectorAll('[data-chat="bubble"]')).toHaveLength(2);
  });

  it('shows a message whose author the server erased (no author) as "Unbekannt"', async () => {
    const { root } = await mountChat(fakeData([msg(1, '', 'Rest')]));
    expect(root.querySelector('[data-chat="head"]')?.textContent).toMatch(/^Unbekannt · /);
  });

  it('renders @ chips with the name (short id when unknown); a mention of me is the yellow chip', async () => {
    const data = fakeData([msg(1, 'anna', 'Hi @me und @bo und @k6hjabcdef12345')]);
    const { root } = await mountChat(data);
    const chips = [...root.querySelectorAll<HTMLElement>('[data-chat="chip"][data-kind="person"]')];
    expect(chips.map((c) => c.textContent)).toEqual(['@Mia', '@Bo', '@2345']);
    expect(chips.map((c) => c.dataset['me'])).toEqual(['true', 'false', 'false']);
  });

  it('renders a # chip as a button with the feature label (short id when unknown); a tap opens the feature and the chat stays', async () => {
    const data = fakeData([msg(1, 'anna', 'Schau #f1 und #zzzzyyyy')]);
    const open = vi.fn<(id: FeatureId) => void>();
    const { root } = await mountChat(data, undefined, 'de', open);
    const chips = [
      ...root.querySelectorAll<HTMLButtonElement>('button[data-chat="chip"][data-kind="feature"]'),
    ];
    expect(chips.map((c) => c.textContent)).toEqual(['#Linde 7', '#yyyy']);
    await fireEvent.click(chips[0] as HTMLElement);
    expect(open).toHaveBeenCalledWith('f1');
    expect(root.querySelector('[data-chat="log"]')).not.toBeNull();
  });

  it('keeps a body as text: nothing in it becomes markup', async () => {
    const data = fakeData([msg(1, 'anna', '<img src=x onerror=alert(1)> <b>fett</b>')]);
    const { root } = await mountChat(data);
    expect(root.querySelector('img, b')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('draws a window of rows, not 10,000 (R14); the window follows the scroll', async () => {
    const items = Array.from({ length: 10_000 }, (_, i) => msg(i + 1, i % 2 === 0 ? 'anna' : 'bo'));
    const data = fakeData(items);
    const { root } = await mountChat(data);
    const scroller = layout(root, { viewport: 700, content: 10_000 * 72, top: 0 });
    await fireEvent.scroll(scroller);
    const first = root.querySelectorAll('[data-chat="group"]');
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(60);
    scroller.scrollTop = 300_000;
    await fireEvent.scroll(scroller);
    const later = [...root.querySelectorAll<HTMLElement>('[data-chat="group"]')];
    expect(later.length).toBeLessThan(60);
    expect(later.map((g) => g.textContent).join('')).not.toBe([...first].map((g) => g.textContent).join(''));
  });
});

describe('scrolling (better than v3: it yanked to the bottom, Sheet:365-380)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => msg(i + 1, 'anna'));

  it('opens at the newest message and follows a new one while the reader is at the bottom', async () => {
    const data = fakeData(many(30));
    const { root } = await mountChat(data);
    const scroller = layout(root, { viewport: 400, content: 1000, top: 600 });
    await fireEvent.scroll(scroller); // at the bottom
    data.set(many(31));
    expect(scroller.scrollTop).toBe(1000);
  });

  it('leaves the reader where they are when they have scrolled up', async () => {
    const data = fakeData(many(30));
    const { root } = await mountChat(data);
    const scroller = layout(root, { viewport: 400, content: 1000, top: 100 });
    await fireEvent.scroll(scroller);
    data.set(many(31));
    expect(scroller.scrollTop).toBe(100);
  });

  it("always follows the reader's own message", async () => {
    const data = fakeData(many(30));
    const { root } = await mountChat(data);
    const scroller = layout(root, { viewport: 400, content: 1000, top: 100 });
    await fireEvent.scroll(scroller);
    data.set([...many(30), msg(31, 'me', 'meins', { seq: null })]);
    expect(scroller.scrollTop).toBe(1000);
  });
});

describe('composer (v3 Composer.svelte)', () => {
  it('has the textarea "Nachricht…", a named send button, and the picker "Jemanden erwähnen"', async () => {
    const { root } = await mountChat(fakeData());
    expect(draft(root).placeholder).toBe('Nachricht…');
    expect(draft(root).getAttribute('aria-label')).toBe('Nachricht schreiben');
    expect(q(root, 'button[type="submit"]').getAttribute('aria-label')).toBe('Senden');
    const picker = q<HTMLSelectElement>(root, 'select');
    expect(picker.getAttribute('aria-label')).toBe('Jemanden erwähnen');
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Jemanden erwähnen', 'Anna', 'Bo']);
  });

  it('shows "Keine Teilnehmer:innen" and is disabled when nobody is on the device', async () => {
    const { root } = await mountChat(fakeData(), chatDeps({ people: () => [] }));
    const picker = q<HTMLSelectElement>(root, 'select');
    expect(picker.disabled).toBe(true);
    expect(picker.options[0]?.textContent).toBe('Keine Teilnehmer:innen');
  });

  it('a picked person goes into the draft as @<id> at the caret; the picker resets', async () => {
    const { root } = await mountChat(fakeData());
    const ta = draft(root);
    ta.value = 'Hallo';
    ta.setSelectionRange(5, 5);
    await fireEvent.input(ta);
    const picker = q<HTMLSelectElement>(root, 'select');
    picker.value = 'anna';
    await fireEvent.change(picker);
    expect(ta.value).toBe('Hallo @anna ');
    expect(picker.value).toBe('');
  });

  it('Enter sends the trimmed draft and clears it; the new message shows as pending', async () => {
    const data = fakeData();
    const { root } = await mountChat(data);
    const ta = draft(root);
    ta.value = '  Moin  ';
    await fireEvent.input(ta);
    await fireEvent.keyDown(ta, { key: 'Enter' });
    await vi.waitFor(() => expect(data.append).toHaveBeenCalledWith('Moin'));
    await vi.waitFor(() => expect(ta.value).toBe(''));
    expect(root.textContent).toContain('Wird gesendet');
  });

  it('Shift+Enter and Alt+Enter add a line instead of sending; a blank draft sends nothing', async () => {
    const data = fakeData();
    const { root } = await mountChat(data);
    const ta = draft(root);
    ta.value = 'a';
    await fireEvent.input(ta);
    await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    await fireEvent.keyDown(ta, { key: 'Enter', altKey: true });
    ta.value = '   ';
    await fireEvent.input(ta);
    await fireEvent.keyDown(ta, { key: 'Enter' });
    expect(data.append).not.toHaveBeenCalled();
    expect(q<HTMLButtonElement>(root, 'button[type="submit"]').disabled).toBe(true);
  });

  it('keeps the draft and says so when the device cannot store the send', async () => {
    const data = fakeData();
    (data.append as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota'));
    const { root } = await mountChat(data);
    const ta = draft(root);
    ta.value = 'Moin';
    await fireEvent.input(ta);
    await fireEvent.keyDown(ta, { key: 'Enter' });
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
    expect(ta.value).toBe('Moin');
  });

  it('a seed ("Im Chat erwähnen") is appended to the draft, not sent, whether it was waiting or arrives later', async () => {
    const data = fakeData();
    const deps = chatDeps();
    deps.pushSeed('#f1 ');
    const { root } = await mountChat(data, deps);
    const ta = draft(root);
    expect(ta.value).toBe('#f1 ');
    ta.value = 'Schau';
    deps.pushSeed('#f2 ');
    expect(ta.value).toBe('Schau #f2 ');
    expect(data.append).not.toHaveBeenCalled();
  });

  it('stops listening for seeds when the panel closes', async () => {
    const deps = chatDeps();
    const { handle } = await mountChat(fakeData(), deps);
    expect(deps.seeds.size).toBe(1);
    handle.destroy();
    expect(deps.seeds.size).toBe(0);
  });
});

describe('pending and refused sends (better than v3: a failed send was lost silently)', () => {
  it('a pending send says so; a refused one shows why with "Erneut senden" and "Verwerfen"', async () => {
    const data = fakeData([
      msg(1, 'me', 'wartet', { seq: null }),
      msg(2, 'me', 'abgelehnt', { seq: null, refusal: { code: 'too_long', reason: 'zu lang' } }),
    ]);
    const { root } = await mountChat(data);
    expect(root.textContent).toContain('Wird gesendet');
    expect(root.textContent).toContain('Nicht gesendet: zu lang');
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-chat="refused"] button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Erneut senden', 'Verwerfen']);
    await fireEvent.click(buttons[0] as HTMLElement);
    expect(data.retry).toHaveBeenCalledWith('m2');
    await fireEvent.click(buttons[1] as HTMLElement);
    expect(data.discard).toHaveBeenCalledWith('m2');
  });
});

describe('reading (v3 unread-store.svelte.ts:349-364, by server seq)', () => {
  it('marks the newest server seq read on open, once, and again for a new batch', async () => {
    const data = fakeData([msg(1, 'anna'), msg(2, 'anna')]);
    await mountChat(data);
    expect(data.markRead).toHaveBeenCalledTimes(1);
    expect(data.markRead).toHaveBeenLastCalledWith(2 as Seq);
    data.set([...data.list, msg(3, 'bo'), msg(4, 'bo')]);
    expect(data.markRead).toHaveBeenCalledTimes(2);
    expect(data.markRead).toHaveBeenLastCalledWith(4 as Seq);
  });

  it('does not mark when everything is read already, and ignores a pending send (it has no seq)', async () => {
    const data = fakeData([msg(1, 'anna')]);
    data.cursorNow = { lastReadSeq: 1 as Seq, lastMentionSeq: 0 as Seq };
    await mountChat(data);
    data.set([...data.list, msg(2, 'me', 'x', { seq: null })]);
    expect(data.markRead).not.toHaveBeenCalled();
  });
});

describe('without a stream', () => {
  it('says the chat is not available for the role', async () => {
    const { root } = await mountChat(undefined);
    expect(root.textContent).toBe('Der Projekt-Chat ist für deine Rolle nicht verfügbar.');
  });
  it('speaks English', async () => {
    const { root } = await mountChat(fakeData(), chatDeps(), 'en');
    expect(root.textContent).toContain('No messages yet. Be the first to say hi.');
    expect(draft(root).placeholder).toBe('Message…');
  });
});

describe.each([
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
])('at $width x $height', ({ width, height }) => {
  it('has no accessibility violations with messages, chips, a pending and a refused send', async () => {
    window.innerWidth = width;
    window.innerHeight = height;
    const data = fakeData([
      msg(1, 'anna', 'Hi @me, schau #f1'),
      msg(2, 'me', 'ok', { seq: null }),
      msg(3, 'me', 'nein', { seq: null, refusal: { code: 'x', reason: 'zu lang' } }),
    ]);
    const { root } = await mountChat(data);
    layout(root, { viewport: height - 120, content: 600 });
    expect(await axeViolations(root)).toEqual([]);
  });
  it('has no accessibility violations when empty and when nobody can be mentioned', async () => {
    const { root } = await mountChat(fakeData(), chatDeps({ people: () => [] }));
    expect(await axeViolations(root)).toEqual([]);
  });
});

describeToolContract({
  name: 'chat',
  tool: () => createChatTool(chatDeps()),
  ports: testPorts(),
});
