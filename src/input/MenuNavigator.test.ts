import { describe, test, expect, vi, afterEach } from 'vitest';

// MenuNavigator needs Phaser only for types + the scene's keyboard/time
// plumbing; stub the module so it runs in the Node test env.
vi.mock('phaser', () => ({ default: {} }));

import { MenuNavigator, NavigableItem } from './MenuNavigator';

const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_X = 2;

interface FakePad {
  connected: boolean;
  buttons: { pressed: boolean }[];
  leftStick: { x: number; y: number };
}

function makeFakePad(): FakePad {
  return {
    connected: true,
    buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
    leftStick: { x: 0, y: 0 },
  };
}

function makeFakeScene() {
  let keydownHandler: ((event: { key: string; preventDefault: () => void }) => void) | null = null;
  let pollCallback: (() => void) | null = null;
  let pollScope: unknown = null;
  let timerRemoved = false;
  const pad = makeFakePad();

  const scene = {
    input: {
      keyboard: {
        on: (_event: string, handler: (event: unknown) => void) => { keydownHandler = handler; },
        off: (_event: string, _handler: (event: unknown) => void) => { keydownHandler = null; },
      },
      gamepad: { pad1: pad },
    },
    time: {
      addEvent: (config: { callback: () => void; callbackScope: unknown }) => {
        pollCallback = config.callback;
        pollScope = config.callbackScope;
        return { remove: () => { timerRemoved = true; pollCallback = null; } };
      },
    },
  };

  return {
    scene: scene as unknown as Phaser.Scene,
    pad,
    pressKey: (key: string) => keydownHandler?.({ key, preventDefault: () => {} }),
    pollGamepad: () => pollCallback?.call(pollScope),
    hasKeydownHandler: () => keydownHandler !== null,
    isTimerRemoved: () => timerRemoved,
  };
}

interface ItemLog {
  focus: number;
  blur: number;
  activate: number;
  left: number;
  right: number;
}

function makeItem(withHorizontalHandlers = false): { item: NavigableItem; log: ItemLog } {
  const log: ItemLog = { focus: 0, blur: 0, activate: 0, left: 0, right: 0 };
  const item: NavigableItem = {
    onFocus: () => { log.focus++; },
    onBlur: () => { log.blur++; },
    onActivate: () => { log.activate++; },
  };
  if (withHorizontalHandlers) {
    item.onLeft = () => { log.left++; };
    item.onRight = () => { log.right++; };
  }
  return { item, log };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MenuNavigator keyboard dispatch', () => {
  test('focuses the initial item on construction', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const b = makeItem();
    new MenuNavigator({ scene: fake.scene, items: [a.item, b.item] });
    expect(a.log.focus).toBe(1);
    expect(b.log.focus).toBe(0);
  });

  test('ArrowDown blurs the old item and focuses the next', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const b = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item] });
    fake.pressKey('ArrowDown');
    expect(a.log.blur).toBe(1);
    expect(b.log.focus).toBe(1);
    expect(nav.getSelectedIndex()).toBe(1);
  });

  test('Enter activates the focused item', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    new MenuNavigator({ scene: fake.scene, items: [a.item] });
    fake.pressKey('Enter');
    expect(a.log.activate).toBe(1);
  });

  test('Escape fires onCancel', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const onCancel = vi.fn();
    new MenuNavigator({ scene: fake.scene, items: [a.item], onCancel });
    fake.pressKey('Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('single-column: ArrowRight/ArrowLeft route to the focused item handlers without moving selection', () => {
    const fake = makeFakeScene();
    const a = makeItem(true);
    const b = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item], columns: 1 });
    fake.pressKey('ArrowRight');
    fake.pressKey('ArrowLeft');
    expect(a.log.right).toBe(1);
    expect(a.log.left).toBe(1);
    expect(nav.getSelectedIndex()).toBe(0);
  });

  test('single-column: a/d keys also route to the item handlers', () => {
    const fake = makeFakeScene();
    const a = makeItem(true);
    new MenuNavigator({ scene: fake.scene, items: [a.item], columns: 1 });
    fake.pressKey('d');
    fake.pressKey('a');
    expect(a.log.right).toBe(1);
    expect(a.log.left).toBe(1);
  });

  test('single-column: horizontal input on an item without handlers is a no-op', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const b = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item], columns: 1 });
    fake.pressKey('ArrowRight');
    expect(nav.getSelectedIndex()).toBe(0);
    expect(a.log.blur).toBe(0);
  });

  test('multi-column: grid navigation wins even when the item has horizontal handlers', () => {
    const fake = makeFakeScene();
    const a = makeItem(true);
    const b = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item], columns: 2 });
    fake.pressKey('ArrowRight');
    expect(nav.getSelectedIndex()).toBe(1);
    expect(a.log.right).toBe(0);
  });
});

describe('MenuNavigator setEnabled', () => {
  test('disabled navigator ignores keyboard input; re-enabling restores it', () => {
    const fake = makeFakeScene();
    const a = makeItem(true);
    const b = makeItem();
    const onCancel = vi.fn();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item], onCancel });

    nav.setEnabled(false);
    fake.pressKey('ArrowDown');
    fake.pressKey('Enter');
    fake.pressKey('ArrowRight');
    fake.pressKey('Escape');
    expect(nav.getSelectedIndex()).toBe(0);
    expect(a.log.activate).toBe(0);
    expect(a.log.right).toBe(0);
    expect(onCancel).not.toHaveBeenCalled();

    nav.setEnabled(true);
    fake.pressKey('ArrowDown');
    expect(nav.getSelectedIndex()).toBe(1);
  });

  test('disabled navigator takes no gamepad actions but keeps button edge state fresh', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const navigator = new MenuNavigator({ scene: fake.scene, items: [a.item] });
    navigator.setEnabled(false);
    fake.pad.buttons[BUTTON_A].pressed = true;
    fake.pollGamepad();
    expect(a.log.activate).toBe(0);

    // Button still held when re-enabled: edge already consumed, no spurious activate.
    navigator.setEnabled(true);
    fake.pollGamepad();
    expect(a.log.activate).toBe(0);

    // Release and press again → real edge → activates.
    fake.pad.buttons[BUTTON_A].pressed = false;
    fake.pollGamepad();
    fake.pad.buttons[BUTTON_A].pressed = true;
    fake.pollGamepad();
    expect(a.log.activate).toBe(1);
  });
});

describe('MenuNavigator gamepad dispatch', () => {
  test('D-pad down moves focus', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const b = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item] });
    fake.pad.buttons[DPAD_DOWN].pressed = true;
    fake.pollGamepad();
    expect(nav.getSelectedIndex()).toBe(1);
  });

  test('held D-pad does not repeat within the repeat window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const fake = makeFakeScene();
    const items = [makeItem(), makeItem(), makeItem()];
    const nav = new MenuNavigator({ scene: fake.scene, items: items.map((i) => i.item) });
    fake.pad.buttons[DPAD_DOWN].pressed = true;
    fake.pollGamepad();
    fake.pollGamepad(); // same instant — inside repeat delay
    expect(nav.getSelectedIndex()).toBe(1);
    vi.setSystemTime(100_250); // past the 200ms repeat delay
    fake.pollGamepad();
    expect(nav.getSelectedIndex()).toBe(2);
  });

  test('single-column: D-pad left/right route to the focused item handlers', () => {
    const fake = makeFakeScene();
    const a = makeItem(true);
    const b = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item], columns: 1 });

    fake.pad.buttons[DPAD_RIGHT].pressed = true;
    fake.pollGamepad();
    expect(a.log.right).toBe(1);
    expect(nav.getSelectedIndex()).toBe(0);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 250);
    fake.pad.buttons[DPAD_RIGHT].pressed = false;
    fake.pad.buttons[DPAD_LEFT].pressed = true;
    fake.pollGamepad();
    expect(a.log.left).toBe(1);
  });

  test('single-column: left stick horizontal routes to the focused item handlers', () => {
    const fake = makeFakeScene();
    const a = makeItem(true);
    new MenuNavigator({ scene: fake.scene, items: [a.item], columns: 1 });
    fake.pad.leftStick.x = 0.9;
    fake.pollGamepad();
    expect(a.log.right).toBe(1);
  });

  test('single-column: D-pad up/down still navigate when the focused item has horizontal handlers', () => {
    const fake = makeFakeScene();
    const a = makeItem(true);
    const b = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item, b.item], columns: 1 });
    fake.pad.buttons[DPAD_UP].pressed = true;
    fake.pollGamepad();
    expect(nav.getSelectedIndex()).toBe(1); // wrapped to last
    expect(a.log.left).toBe(0);
  });

  test('A button activates once per press (edge-detected)', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    new MenuNavigator({ scene: fake.scene, items: [a.item] });
    fake.pad.buttons[BUTTON_A].pressed = true;
    fake.pollGamepad();
    fake.pollGamepad(); // still held — no second activation
    expect(a.log.activate).toBe(1);
  });

  test('a button already held at construction does not fire a stale edge', () => {
    // Scenario: a confirmation navigator is created BY an A-press on another
    // navigator. The still-held A must not instantly activate the new one.
    const fake = makeFakeScene();
    fake.pad.buttons[BUTTON_A].pressed = true;
    const a = makeItem();
    new MenuNavigator({ scene: fake.scene, items: [a.item] });
    fake.pollGamepad();
    expect(a.log.activate).toBe(0);

    // Release and press again → real edge → activates.
    fake.pad.buttons[BUTTON_A].pressed = false;
    fake.pollGamepad();
    fake.pad.buttons[BUTTON_A].pressed = true;
    fake.pollGamepad();
    expect(a.log.activate).toBe(1);
  });

  test('B button fires onCancel', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const onCancel = vi.fn();
    new MenuNavigator({ scene: fake.scene, items: [a.item], onCancel });
    fake.pad.buttons[BUTTON_B].pressed = true;
    fake.pollGamepad();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('X button fires onSecondary once per press (edge-detected)', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const onSecondary = vi.fn();
    new MenuNavigator({ scene: fake.scene, items: [a.item], onSecondary });
    fake.pad.buttons[BUTTON_X].pressed = true;
    fake.pollGamepad();
    fake.pollGamepad(); // still held — no second fire
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  test('X button does nothing when no onSecondary is supplied', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    // No throw, no activate — just a no-op.
    new MenuNavigator({ scene: fake.scene, items: [a.item] });
    fake.pad.buttons[BUTTON_X].pressed = true;
    expect(() => fake.pollGamepad()).not.toThrow();
    expect(a.log.activate).toBe(0);
  });

  test('onSecondary does not fire while the navigator is disabled', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const onSecondary = vi.fn();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item], onSecondary });
    nav.setEnabled(false);
    fake.pad.buttons[BUTTON_X].pressed = true;
    fake.pollGamepad();
    expect(onSecondary).not.toHaveBeenCalled();
    // Re-enabling does not replay the stale held press as an edge.
    nav.setEnabled(true);
    fake.pollGamepad();
    expect(onSecondary).not.toHaveBeenCalled();
  });
});

describe('MenuNavigator cleanup', () => {
  test('destroy removes the keyboard listener and the gamepad poll timer', () => {
    const fake = makeFakeScene();
    const a = makeItem();
    const nav = new MenuNavigator({ scene: fake.scene, items: [a.item] });
    nav.destroy();
    expect(fake.hasKeydownHandler()).toBe(false);
    expect(fake.isTimerRemoved()).toBe(true);
  });
});
