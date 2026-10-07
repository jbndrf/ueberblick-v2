// @vitest-environment jsdom
// WP-435: the pointer drag of the canvas (reorder grip, tool icon). jsdom has no layout, so `hit` says what is under the pointer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDrag, targetAt, type DragPayload } from './drag';

function setup(onDrop = vi.fn()) {
  document.body.innerHTML = `
    <div id="a" data-task-id="a" data-scope="s"><span id="grip"></span></div>
    <div id="b" data-task-id="b" data-scope="s"></div>
    <div id="c" data-task-id="c" data-scope="other"></div>
    <div id="add" data-add-task data-scope="s"></div>`;
  const grip = document.getElementById('grip') as HTMLElement;
  const payload: DragPayload = { kind: 'reorder', task: 'a', scope: 's' };
  let under: Element[] = [];
  grip.addEventListener('pointerdown', (e) => startDrag(e, payload, { onDrop, hit: () => under }));
  // This jsdom has no PointerEvent: a mouse event with the pointer fields the drag reads.
  const fire = (type: string, init: MouseEventInit = {}) =>
    grip.dispatchEvent(
      Object.assign(new MouseEvent(type, { bubbles: true, button: 0, ...init }), {
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );
  return { grip, onDrop, fire, over: (id: string) => (under = [document.getElementById(id) as Element]) };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('targetAt', () => {
  it('reads a button, or the "Button hinzufügen" row as the end of its scope', () => {
    setup();
    expect(targetAt([document.getElementById('b') as Element])).toMatchObject({ task: 'b', scope: 's' });
    expect(targetAt([document.getElementById('add') as Element])).toMatchObject({ task: '', scope: 's' });
    expect(targetAt([document.body])).toBeUndefined();
  });
});

describe('startDrag', () => {
  it('a press that does not move is a click: nothing drops', () => {
    const { fire, onDrop } = setup();
    fire('pointerdown', { clientX: 5, clientY: 5 });
    fire('pointermove', { clientX: 6, clientY: 6 });
    fire('pointerup', { clientX: 6, clientY: 6 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('marks the button under the pointer while dragging and drops on it at release; Alt says copy', () => {
    const { fire, onDrop, over, grip } = setup();
    fire('pointerdown', { clientX: 5, clientY: 5 });
    over('b');
    fire('pointermove', { clientX: 30, clientY: 40 });
    expect(document.getElementById('b')?.hasAttribute('data-drop')).toBe(true);
    expect(grip.hasAttribute('data-dragging')).toBe(true);
    fire('pointerup', { clientX: 30, clientY: 40, altKey: true });
    expect(onDrop).toHaveBeenCalledTimes(1);
    const [payload, target, copy] = onDrop.mock.calls[0] ?? [];
    expect(payload).toEqual({ kind: 'reorder', task: 'a', scope: 's' });
    expect(target).toMatchObject({ task: 'b' });
    expect(copy).toBe(true);
    expect(document.getElementById('b')?.hasAttribute('data-drop')).toBe(false);
    expect(grip.hasAttribute('data-dragging')).toBe(false);
  });

  it('released over nothing, it drops with no target; Escape cancels', () => {
    const first = setup();
    first.fire('pointerdown', { clientX: 5, clientY: 5 });
    first.fire('pointermove', { clientX: 50, clientY: 5 });
    first.fire('pointerup', { clientX: 50, clientY: 5 });
    expect(first.onDrop).toHaveBeenCalledWith(expect.anything(), undefined, false);
    const second = setup();
    second.fire('pointerdown', { clientX: 5, clientY: 5 });
    second.over('b');
    second.fire('pointermove', { clientX: 50, clientY: 5 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    second.fire('pointerup', { clientX: 50, clientY: 5 });
    expect(second.onDrop).not.toHaveBeenCalled();
  });
});
