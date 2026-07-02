/**
 * MenuTab — horizontal tab strip for tabbed menu scenes (Shop, Achievement,
 * Codex, Settings).
 *
 * Each tab is rendered as a `MenuButton` with banner-less body. Active tab
 * gets the accent color; inactive tabs get the neutral body. Switching is
 * driven by `setActive(id)`; `onChange` fires per click.
 */

import Phaser from 'phaser';
import { createMenuButton, MenuButton } from './MenuButton';
import { RoleColorKey } from './MenuStyle';

export interface MenuTabSpec {
  id: string;
  label: string;
  /** Color role for the active state. Inactive always uses neutral. */
  accentRole?: RoleColorKey;
}

export interface MenuTabsOptions {
  scene: Phaser.Scene;
  x: number;
  y: number;
  tabs: MenuTabSpec[];
  tabWidth: number;
  tabHeight: number;
  spacing?: number;
  fontSize?: number;
  initialActiveId?: string;
  onChange: (id: string) => void;
}

export interface MenuTabs {
  container: Phaser.GameObjects.Container;
  setActive(id: string): void;
  getActive(): string;
  getButton(id: string): MenuButton | undefined;
  tickIdle(timeSeconds: number): void;
  destroy(): void;
}

interface TabEntry {
  spec: MenuTabSpec;
  button: MenuButton;
}

export function createMenuTabs(opts: MenuTabsOptions): MenuTabs {
  const {
    scene,
    x,
    y,
    tabs,
    tabWidth,
    tabHeight,
    spacing = 12,
    fontSize,
    initialActiveId,
    onChange,
  } = opts;

  const container = scene.add.container(x, y);
  const totalWidth = tabs.length * tabWidth + (tabs.length - 1) * spacing;
  const startX = -totalWidth / 2 + tabWidth / 2;

  let activeId = initialActiveId ?? tabs[0]?.id ?? '';
  const entries: TabEntry[] = [];

  tabs.forEach((spec, index) => {
    const cx = startX + index * (tabWidth + spacing);
    const isActive = spec.id === activeId;
    const button = createMenuButton({
      scene,
      x: cx,
      y: 0,
      width: tabWidth,
      height: tabHeight,
      label: spec.label,
      variant: isActive ? spec.accentRole ?? 'primary' : 'neutral',
      fontSize,
      onActivate: () => {
        if (activeId === spec.id) return;
        setActiveInternal(spec.id);
        onChange(spec.id);
      },
    });
    if (!isActive) {
      button.container.setAlpha(0.7);
    }
    container.add(button.container);
    entries.push({ spec, button });
  });

  function setActiveInternal(id: string) {
    applyActiveVisuals(id);
  }

  function applyActiveVisuals(id: string) {
    activeId = id;
    for (const entry of entries) {
      const becomingActive = entry.spec.id === id;
      entry.button.container.setAlpha(becomingActive ? 1 : 0.7);
      // Visual focus pop on the active tab.
      entry.button.card.setFocusState(becomingActive);
    }
  }

  // The active tab glows from the moment the strip appears — previously the
  // selection treatment only kicked in after the first click.
  applyActiveVisuals(activeId);

  return {
    container,
    setActive(id: string) {
      setActiveInternal(id);
    },
    getActive() {
      return activeId;
    },
    getButton(id: string) {
      return entries.find((e) => e.spec.id === id)?.button;
    },
    tickIdle(timeSeconds: number) {
      for (const entry of entries) entry.button.tickIdle(timeSeconds);
    },
    destroy() {
      for (const entry of entries) entry.button.destroy();
      container.destroy();
    },
  };
}
