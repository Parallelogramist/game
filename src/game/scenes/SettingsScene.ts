/**
 * SettingsScene — card grid layout.
 *
 * Four panels: AUDIO, VISUALS, COMBAT/HUD, DATA. Each panel is a MenuCard with
 * an accent banner header. Toggles render as ON/OFF pill segments; multi-select
 * options (playback mode, damage numbers) render as segmented pills. Volume
 * rows show a 10-segment bar between -/+ buttons.
 */

import Phaser from 'phaser';
import {
  getSettingsManager,
  DamageNumbersMode,
  ColorblindMode,
  COLORBLIND_MODE_OPTIONS,
  indexOfColorblindMode,
  colorblindModeAtIndex,
} from '../../settings';
import { getMusicManager } from '../../audio/MusicManager';
import type { GameScene } from './GameScene';
import { addButtonInteraction, transitionToScene, sweepIn } from '../../utils/SceneTransition';
import { SecureStorage, ALL_STORAGE_KEYS, exportProfileBlob } from '../../storage';
import { showProfileExportOverlay, showProfileImportOverlay } from '../../ui/ProfileTransferOverlay';
import {
  computeMenuLayoutScale,
  computeMenuFontScale,
  computeMenuLayoutScalePortrait,
  computeMenuFontScalePortrait,
  scaledFontPx,
  scaledInt,
} from '../../utils/HudScale';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { createMenuOverlay, MenuOverlay } from '../../visual/MenuOverlay';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { ACCENT_COLORS, ACCENT_COLORS_STR, BODY_COLORS, TEXT_COLORS } from '../../visual/MenuStyle';

type FocusZone =
  | 'sfx' | 'sfxVolume' | 'bgm' | 'bgmVolume' | 'playbackMode' | 'musicTracks'
  | 'screenShake' | 'reducedMotion' | 'gridEffects' | 'fpsCounter'
  | 'colorblind' | 'highContrast' | 'minimap'
  | 'uiScale'
  | 'damageNumbers' | 'statusText'
  | 'exportProfile' | 'importProfile' | 'resetData' | 'back';

interface SettingsSceneData {
  returnTo: 'BootScene' | 'GameScene';
}

interface PillHandle {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  width: number;
  height: number;
}

interface ToggleControl {
  refresh(enabled: boolean): void;
  setFocused(focused: boolean): void;
}

interface VolumeControl {
  refresh(percent01: number): void;
  setFocused(focused: boolean): void;
}

interface SegmentedControl<T extends string> {
  refresh(activeValue: T, focusedIndex: number | null): void;
}

interface StepperHandles {
  minusButton: Phaser.GameObjects.Text;
  plusButton: Phaser.GameObjects.Text;
  valueLabel: Phaser.GameObjects.Text;
}

const FONT_FAMILY = '"Atkinson Hyperlegible", Arial, sans-serif';

const PILL_PALETTE = {
  neutral: { fill: 0x1c2538, border: ACCENT_COLORS.neutral, text: TEXT_COLORS.muted },
  neutralActive: { fill: ACCENT_COLORS.focus, border: ACCENT_COLORS.focus, text: '#1a1408' },
  focusBorder: ACCENT_COLORS.focus,
} as const;

// Sliding-switch colors for boolean settings. Green track = enabled reads
// unambiguously; the old twin ON/OFF pills made users guess whether the
// highlighted pill was the state or the button.
const SWITCH_COLORS = {
  trackOn: ACCENT_COLORS.safe,
  trackOff: 0x2a3450,
  trackBorderOff: 0x46527a,
  knobOn: 0xf2f6ff,
  knobOff: 0x8898b0,
  labelOn: '#a8f5c4',
} as const;

export class SettingsScene extends Phaser.Scene {
  private returnTo: 'BootScene' | 'GameScene' = 'BootScene';
  /** UI scale at scene entry — a change on exit triggers the in-run rebuild. */
  private uiScaleOnEntry: number = 1;

  private toggles: Partial<Record<FocusZone, ToggleControl>> = {};
  private volumes: Partial<Record<FocusZone, VolumeControl>> = {};
  private playbackSegmented!: SegmentedControl<'sequential' | 'shuffle'>;
  private damageNumbersSegmented!: SegmentedControl<DamageNumbersMode>;
  private colorblindSegmented!: SegmentedControl<ColorblindMode>;

  private uiScaleHandles!: StepperHandles;

  private musicTracksButton!: MenuButton;
  private resetDataButton!: MenuButton;
  private exportProfileButton!: MenuButton;
  private importProfileButton!: MenuButton;
  private profileOverlayTeardown: (() => void) | null = null;
  private backButton!: MenuButton;

  private soundManager!: SoundManager;
  private menuButtons: MenuButton[] = [];

  private confirmOverlay: Phaser.GameObjects.GameObject[] = [];
  private confirmFocusIndex: number = 1;
  private confirmButtonRef: MenuButton | null = null;
  private cancelButtonRef: MenuButton | null = null;

  private focusZone: FocusZone = 'sfx';
  private damageNumberIndex: number = 0;
  private playbackModeIndex: number = 0;
  private colorblindModeIndex: number = 0;
  private menuNavigator: MenuNavigator | null = null;
  private confirmNavigator: MenuNavigator | null = null;

  private layoutScale: number = 1;
  private fontScale: number = 1;
  private menuOverlay: MenuOverlay | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private idleCards: MenuCard[] = [];

  constructor() {
    super({ key: 'SettingsScene' });
  }

  init(data: SettingsSceneData): void {
    this.returnTo = data?.returnTo || 'BootScene';
  }

  create(): void {
    this.soundManager = new SoundManager(this);
    const centerX = this.cameras.main.centerX;
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();

    // Portrait: the orientation-matched design fit (720×1280 → scale 1.0)
    // with the cards stacked in ONE centered column — the landscape fit
    // shrank everything to 56% and let the density-boosted pill text
    // overflow its shrunken containers.
    const portrait = this.scale.height > this.scale.width;
    this.layoutScale = portrait
      ? computeMenuLayoutScalePortrait(this.scale.width, this.scale.height)
      : computeMenuLayoutScale(this.scale.width, this.scale.height);
    this.fontScale = portrait
      ? computeMenuFontScalePortrait(this.scale.width, this.scale.height, settingsManager.getUiScale())
      : computeMenuFontScale(this.scale.width, this.scale.height, settingsManager.getUiScale());
    this.uiScaleOnEntry = settingsManager.getUiScale();

    this.toggles = {};
    this.volumes = {};
    this.menuButtons = [];
    this.idleCards = [];
    this.focusZone = 'sfx';
    this.damageNumberIndex = this.indexOfDamageMode(settingsManager.getDamageNumbersMode());
    this.playbackModeIndex = musicManager.getPlaybackMode() === 'shuffle' ? 1 : 0;
    this.colorblindModeIndex = indexOfColorblindMode(settingsManager.getColorblindMode());

    sweepIn(this);

    this.menuOverlay = createMenuOverlay(this, { dim: 0.85, drifterCount: 4 });
    this.bgUpdateHandler = (time, delta) => {
      this.menuOverlay?.update(delta);
      const seconds = time / 1000;
      for (const card of this.idleCards) card.tickIdle(seconds);
      for (const btn of this.menuButtons) btn.tickIdle(seconds);
    };
    this.events.on('update', this.bgUpdateHandler);

    const titleText = makeDisplayText(this, centerX, scaledInt(this.layoutScale, 36), 'SETTINGS', {
      fontSize: 38,
      color: ACCENT_COLORS_STR.gold,
      strokeWidth: 6,
      letterSpacing: 4,
    });
    titleText.setFontSize(scaledFontPx(this.fontScale, 38));

    // ── Card grid ──────────────────────────────────────────────────────────
    const cardWidth = scaledInt(this.layoutScale, 560);
    const gapX = scaledInt(this.layoutScale, 24);
    const gapY = scaledInt(this.layoutScale, 18);
    // Portrait: one centered column (AUDIO → COMBAT → VISUALS → DATA);
    // landscape: the original two-column grid.
    const leftCenterX = portrait ? centerX : centerX - cardWidth / 2 - gapX / 2;
    const rightCenterX = portrait ? centerX : centerX + cardWidth / 2 + gapX / 2;
    const topRowY = scaledInt(this.layoutScale, 80);

    const audioCardHeight = scaledInt(this.layoutScale, 320);
    const combatCardHeight = scaledInt(this.layoutScale, 160);
    const visualsCardHeight = scaledInt(this.layoutScale, 360);
    const dataCardHeight = scaledInt(this.layoutScale, 176);

    const audioTopY = topRowY + audioCardHeight / 2;
    const combatTopY = topRowY + audioCardHeight + gapY + combatCardHeight / 2;
    const leftColumnBottom = topRowY + audioCardHeight + gapY + combatCardHeight + gapY;
    const visualsTopY = (portrait ? leftColumnBottom : topRowY) + visualsCardHeight / 2;
    const dataTopY =
      (portrait ? leftColumnBottom : topRowY) + visualsCardHeight + gapY + dataCardHeight / 2;

    this.buildAudioCard(leftCenterX, audioTopY, cardWidth, audioCardHeight);
    this.buildCombatCard(leftCenterX, combatTopY, cardWidth, combatCardHeight);
    this.buildVisualsCard(rightCenterX, visualsTopY, cardWidth, visualsCardHeight);
    this.buildDataCard(rightCenterX, dataTopY, cardWidth, dataCardHeight);

    const backButtonY = this.cameras.main.height - scaledInt(this.layoutScale, 38);
    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: backButtonY,
      width: scaledInt(this.layoutScale, 220),
      height: scaledInt(this.layoutScale, 50),
      label: 'BACK',
      variant: 'neutral',
      fontSize: scaledInt(this.fontScale, 20),
      onActivate: () => {
        this.soundManager.playUIClick();
        this.goBack();
      },
    });
    this.menuButtons.push(this.backButton);

    this.buildMenuNavigator();
    this.refreshAllFocusVisuals();

    this.events.once('shutdown', this.shutdown, this);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Card builders
  // ──────────────────────────────────────────────────────────────────────────

  private buildAudioCard(centerX: number, centerY: number, width: number, height: number): void {
    const card = this.makeSectionCard(centerX, centerY, width, height, 'AUDIO', ACCENT_COLORS.gold, BODY_COLORS.primary);

    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();

    const labelX = -width / 2 + scaledInt(this.layoutScale, 28);
    const controlX = width / 2 - scaledInt(this.layoutScale, 28);
    const startY = -height / 2 + scaledInt(this.layoutScale, 70);
    const rowGap = scaledInt(this.layoutScale, 38);

    this.addRowLabel(card, labelX, startY, 'SFX');
    this.toggles['sfx'] = this.addToggle(card, controlX, startY, 'sfx', settingsManager.isSfxEnabled(), () => {
      const next = !settingsManager.isSfxEnabled();
      settingsManager.setSfxEnabled(next);
      this.refreshAllFocusVisuals();
    });

    this.addRowLabel(card, labelX, startY + rowGap, 'SFX Volume');
    this.volumes['sfxVolume'] = this.addVolumeRow(card, controlX, startY + rowGap, 'sfxVolume',
      settingsManager.getSfxVolume(),
      (delta) => {
        settingsManager.setSfxVolume(settingsManager.getSfxVolume() + delta);
        this.refreshAllFocusVisuals();
      });

    this.addRowLabel(card, labelX, startY + rowGap * 2, 'Music');
    const bgmEnabled = musicManager.getPlaybackMode() !== 'off';
    this.toggles['bgm'] = this.addToggle(card, controlX, startY + rowGap * 2, 'bgm', bgmEnabled, () => {
      if (musicManager.getPlaybackMode() === 'off') {
        musicManager.setPlaybackMode('sequential');
        musicManager.play();
      } else {
        musicManager.setPlaybackMode('off');
        musicManager.stop();
      }
      this.refreshAllFocusVisuals();
    });

    this.addRowLabel(card, labelX, startY + rowGap * 3, 'Music Volume');
    this.volumes['bgmVolume'] = this.addVolumeRow(card, controlX, startY + rowGap * 3, 'bgmVolume',
      musicManager.getVolume(),
      (delta) => {
        musicManager.setVolume(musicManager.getVolume() + delta);
        this.refreshAllFocusVisuals();
      });

    this.addRowLabel(card, labelX, startY + rowGap * 4, 'Playback');
    this.playbackSegmented = this.addSegmented<'sequential' | 'shuffle'>(
      card, controlX, startY + rowGap * 4, 'playbackMode',
      [
        { value: 'sequential', label: 'Sequential' },
        { value: 'shuffle', label: 'Shuffle' },
      ],
      this.resolvePlaybackValue(),
      (value, index) => {
        const wasOff = musicManager.getPlaybackMode() === 'off';
        musicManager.setPlaybackMode(value);
        this.playbackModeIndex = index;
        if (wasOff) musicManager.play();
        this.refreshAllFocusVisuals();
      },
    );

    const trackButtonY = startY + rowGap * 5 + scaledInt(this.layoutScale, 14);
    this.musicTracksButton = createMenuButton({
      scene: this,
      x: 0,
      y: trackButtonY,
      width: width - scaledInt(this.layoutScale, 80),
      height: scaledInt(this.layoutScale, 42),
      label: 'BROWSE TRACKS',
      variant: 'gold',
      fontSize: scaledInt(this.fontScale, 16),
      onActivate: () => {
        this.soundManager.playUIClick();
        transitionToScene(this, 'MusicSettingsScene', { returnTo: 'SettingsScene', originalReturnTo: this.returnTo });
      },
    });
    card.frame.add(this.musicTracksButton.container);
    this.menuButtons.push(this.musicTracksButton);
    this.musicTracksButton.card.hitZone.on('pointerover', () => {
      this.focusZone = 'musicTracks';
      this.refreshAllFocusVisuals();
    });
  }

  private buildVisualsCard(centerX: number, centerY: number, width: number, height: number): void {
    const card = this.makeSectionCard(centerX, centerY, width, height, 'VISUALS', ACCENT_COLORS.primary, BODY_COLORS.primary);

    const settingsManager = getSettingsManager();

    const labelX = -width / 2 + scaledInt(this.layoutScale, 28);
    const controlX = width / 2 - scaledInt(this.layoutScale, 28);
    const startY = -height / 2 + scaledInt(this.layoutScale, 70);
    const rowGap = scaledInt(this.layoutScale, 36);

    const buildToggleRow = (offsetRow: number, label: string, zone: FocusZone, getter: () => boolean, setter: (value: boolean) => void) => {
      const rowY = startY + rowGap * offsetRow;
      this.addRowLabel(card, labelX, rowY, label);
      this.toggles[zone] = this.addToggle(card, controlX, rowY, zone, getter(), () => {
        setter(!getter());
        this.refreshAllFocusVisuals();
      });
    };

    buildToggleRow(0, 'Screen Shake', 'screenShake',
      () => settingsManager.isScreenShakeEnabled(),
      (v) => settingsManager.setScreenShakeEnabled(v));

    buildToggleRow(1, 'Reduced Motion', 'reducedMotion',
      () => settingsManager.isReducedMotionEnabled(),
      (v) => settingsManager.setReducedMotion(v));

    buildToggleRow(2, 'Grid Effects', 'gridEffects',
      () => settingsManager.isGridEffectsEnabled(),
      (v) => settingsManager.setGridEffectsEnabled(v));

    buildToggleRow(3, 'FPS Counter', 'fpsCounter',
      () => settingsManager.isFpsCounterEnabled(),
      (v) => settingsManager.setFpsCounterEnabled(v));

    const colorblindY = startY + rowGap * 4;
    this.addRowLabel(card, labelX, colorblindY, 'Colorblind');
    this.colorblindSegmented = this.addSegmented<ColorblindMode>(
      card, controlX, colorblindY, 'colorblind',
      [...COLORBLIND_MODE_OPTIONS],
      settingsManager.getColorblindMode(),
      (value, index) => {
        settingsManager.setColorblindMode(value);
        this.colorblindModeIndex = index;
        this.refreshAllFocusVisuals();
      },
    );

    buildToggleRow(5, 'High Contrast', 'highContrast',
      () => settingsManager.isHighContrastEnabled(),
      (v) => settingsManager.setHighContrast(v));

    buildToggleRow(6, 'Minimap', 'minimap',
      () => settingsManager.isMinimapEnabled(),
      (v) => settingsManager.setMinimapEnabled(v));

    const uiScaleY = startY + rowGap * 7;
    this.addRowLabel(card, labelX, uiScaleY, 'UI Scale');
    this.uiScaleHandles = this.addStepperRow(card, controlX, uiScaleY, 'uiScale',
      () => `${Math.round(settingsManager.getUiScale() * 100)}%`,
      (delta) => {
        settingsManager.setUiScale(settingsManager.getUiScale() + delta);
        this.scene.restart({ returnTo: this.returnTo });
      },
    );

  }

  private buildCombatCard(centerX: number, centerY: number, width: number, height: number): void {
    const card = this.makeSectionCard(centerX, centerY, width, height, 'COMBAT TEXT', ACCENT_COLORS.magenta, BODY_COLORS.magenta);

    const settingsManager = getSettingsManager();

    const labelX = -width / 2 + scaledInt(this.layoutScale, 28);
    const controlX = width / 2 - scaledInt(this.layoutScale, 28);
    const startY = -height / 2 + scaledInt(this.layoutScale, 70);
    const rowGap = scaledInt(this.layoutScale, 36);

    this.addRowLabel(card, labelX, startY, 'Damage Numbers');
    this.damageNumbersSegmented = this.addSegmented<DamageNumbersMode>(
      card, controlX, startY, 'damageNumbers',
      [
        { value: 'all', label: 'All' },
        { value: 'crits', label: 'Crits' },
        { value: 'perfect_crits', label: 'Perfect' },
        { value: 'off', label: 'Off' },
      ],
      settingsManager.getDamageNumbersMode(),
      (value, index) => {
        settingsManager.setDamageNumbersMode(value);
        this.damageNumberIndex = index;
        this.refreshAllFocusVisuals();
      },
    );

    const statusY = startY + rowGap;
    this.addRowLabel(card, labelX, statusY, 'Status Text');
    this.toggles['statusText'] = this.addToggle(card, controlX, statusY, 'statusText',
      settingsManager.isStatusTextEnabled(),
      () => {
        settingsManager.setStatusTextEnabled(!settingsManager.isStatusTextEnabled());
        this.refreshAllFocusVisuals();
      });

    const hintText = makeBodyText(this, labelX, statusY + scaledInt(this.layoutScale, 22), 'DODGE, BLOCKED, IMMUNE, etc.', {
      fontSize: scaledInt(this.fontScale, 11),
      color: TEXT_COLORS.dim,
      align: 'left',
    });
    card.frame.add(hintText);
  }

  private buildDataCard(centerX: number, centerY: number, width: number, height: number): void {
    const card = this.makeSectionCard(centerX, centerY, width, height, 'DATA', ACCENT_COLORS.danger, BODY_COLORS.danger);

    const pairWidth = (width - scaledInt(this.layoutScale, 96)) / 2;
    const pairOffsetX = pairWidth / 2 + scaledInt(this.layoutScale, 8);
    const profileRowY = -height / 2 + scaledInt(this.layoutScale, 60);

    this.exportProfileButton = createMenuButton({
      scene: this, x: -pairOffsetX, y: profileRowY,
      width: pairWidth, height: scaledInt(this.layoutScale, 42),
      label: 'EXPORT', variant: 'teal', fontSize: scaledInt(this.fontScale, 16),
      onActivate: () => { this.soundManager.playUIClick(); void this.openProfileExport(); },
    });
    card.frame.add(this.exportProfileButton.container);
    this.menuButtons.push(this.exportProfileButton);
    this.exportProfileButton.card.hitZone.on('pointerover', () => {
      this.focusZone = 'exportProfile';
      this.refreshAllFocusVisuals();
    });

    this.importProfileButton = createMenuButton({
      scene: this, x: pairOffsetX, y: profileRowY,
      width: pairWidth, height: scaledInt(this.layoutScale, 42),
      label: 'IMPORT', variant: 'teal', fontSize: scaledInt(this.fontScale, 16),
      onActivate: () => { this.soundManager.playUIClick(); this.openProfileImport(); },
    });
    card.frame.add(this.importProfileButton.container);
    this.menuButtons.push(this.importProfileButton);
    this.importProfileButton.card.hitZone.on('pointerover', () => {
      this.focusZone = 'importProfile';
      this.refreshAllFocusVisuals();
    });

    const profileHint = makeBodyText(this, 0, profileRowY + scaledInt(this.layoutScale, 30),
      'Back up your progress or move it to another device.', {
        fontSize: scaledInt(this.fontScale, 11), color: TEXT_COLORS.dim, align: 'center',
      });
    card.frame.add(profileHint);

    const resetY = profileRowY + scaledInt(this.layoutScale, 60);
    this.resetDataButton = createMenuButton({
      scene: this,
      x: 0,
      y: resetY,
      width: width - scaledInt(this.layoutScale, 80),
      height: scaledInt(this.layoutScale, 42),
      label: 'RESET ALL DATA',
      variant: 'danger',
      fontSize: scaledInt(this.fontScale, 16),
      onActivate: () => {
        this.soundManager.playUIClick();
        this.showResetConfirmation();
      },
    });
    card.frame.add(this.resetDataButton.container);
    this.menuButtons.push(this.resetDataButton);
    this.resetDataButton.card.hitZone.on('pointerover', () => {
      this.focusZone = 'resetData';
      this.refreshAllFocusVisuals();
    });

    const warning = makeBodyText(this, 0, resetY + scaledInt(this.layoutScale, 30),
      'Erases progress, upgrades, achievements, settings.', {
        fontSize: scaledInt(this.fontScale, 11),
        color: TEXT_COLORS.dim,
        align: 'center',
      });
    card.frame.add(warning);
  }

  private async openProfileExport(): Promise<void> {
    if (this.profileOverlayTeardown) return;
    const blobText = await exportProfileBlob(Date.now());
    this.menuNavigator?.setEnabled(false);
    this.profileOverlayTeardown = showProfileExportOverlay(blobText, () => this.closeProfileOverlay());
  }

  private openProfileImport(): void {
    if (this.profileOverlayTeardown) return;
    this.menuNavigator?.setEnabled(false);
    this.profileOverlayTeardown = showProfileImportOverlay(
      () => window.location.reload(),
      () => this.closeProfileOverlay(),
    );
  }

  private closeProfileOverlay(): void {
    this.profileOverlayTeardown?.();
    this.profileOverlayTeardown = null;
    this.menuNavigator?.setEnabled(true);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Layout primitives
  // ──────────────────────────────────────────────────────────────────────────

  private makeSectionCard(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    title: string,
    accentColor: number,
    bodyColor: number,
  ): MenuCard {
    const bannerHeight = scaledInt(this.layoutScale, 34);
    const card = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width,
      height,
      bodyFillColor: bodyColor,
      bodyFillAlpha: 0.96,
      accentColor,
      bannerHeight,
      borderWidth: 2,
      borderColor: accentColor,
      cornerRadius: 8,
      shadowOffsetX: 4,
      shadowOffsetY: 10,
      shadowAlpha: 0.6,
      interactive: false,
    });
    this.idleCards.push(card);

    const bannerLabel = makeDisplayText(this, 0, -height / 2 + bannerHeight / 2 - scaledInt(this.layoutScale, 1), title, {
      fontSize: 18,
      color: '#101018',
      strokeWidth: 0,
      letterSpacing: 3,
    });
    bannerLabel.setFontSize(scaledFontPx(this.fontScale, 18));
    card.frame.add(bannerLabel);

    return card;
  }

  private addRowLabel(card: MenuCard, x: number, y: number, label: string): Phaser.GameObjects.Text {
    const text = this.add.text(x, y, label, {
      fontSize: scaledFontPx(this.fontScale, 15),
      color: TEXT_COLORS.body,
      fontFamily: FONT_FAMILY,
    }).setOrigin(0, 0.5);
    card.frame.add(text);
    return text;
  }

  // ── Pill primitive ────────────────────────────────────────────────────────

  private createPill(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    initialPalette: { fill: number; border: number; text: string },
    onClick: () => void,
    onHover: () => void,
  ): PillHandle {
    const container = this.add.container(x, y);
    parent.add(container);

    const background = this.add.graphics();
    this.drawPill(background, width, height, initialPalette.fill, initialPalette.border, false);
    container.add(background);

    const labelText = this.add.text(0, 0, label, {
      fontSize: scaledFontPx(this.fontScale, 12),
      color: initialPalette.text,
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(labelText);

    const hitZone = this.add.zone(0, 0, width, height).setOrigin(0.5).setInteractive({ useHandCursor: true });
    container.add(hitZone);

    hitZone.on('pointerdown', () => {
      this.soundManager.playUIClick();
      onClick();
    });
    hitZone.on('pointerover', onHover);

    return { container, background, label: labelText, width, height };
  }

  private drawPill(graphics: Phaser.GameObjects.Graphics, width: number, height: number, fill: number, border: number, glow: boolean): void {
    graphics.clear();
    const radius = Math.min(height / 2, 14);
    const halfW = width / 2;
    const halfH = height / 2;

    if (glow) {
      graphics.fillStyle(border, 0.35);
      graphics.fillRoundedRect(-halfW - 3, -halfH - 3, width + 6, height + 6, radius + 3);
    }

    graphics.lineStyle(2, border, 1);
    graphics.fillStyle(fill, 1);
    graphics.fillRoundedRect(-halfW, -halfH, width, height, radius);
    graphics.strokeRoundedRect(-halfW, -halfH, width, height, radius);
  }

  // ── ON/OFF toggle ─────────────────────────────────────────────────────────

  private addToggle(card: MenuCard, rightAlignX: number, y: number, zone: FocusZone, initialEnabled: boolean, onToggle: () => void): ToggleControl {
    // One sliding switch per setting: filled green track + knob right = on,
    // dim track + knob left = off, with the state spelled out beside it.
    // Replaces the twin ON/OFF pills, where BOTH pills fired the same toggle
    // (clicking “OFF” while off turned the setting on) and the highlighted
    // pill was ambiguous between current-state and call-to-action.
    const trackWidth = scaledInt(this.layoutScale, 46);
    const trackHeight = scaledInt(this.layoutScale, 24);
    const knobInset = scaledInt(this.layoutScale, 3);
    const knobRadius = Math.max(6, Math.round(trackHeight / 2) - knobInset);
    const trackCenterX = rightAlignX - trackWidth / 2;
    const knobTravel = trackWidth / 2 - knobInset - knobRadius;

    const track = this.add.graphics();
    card.frame.add(track);

    const knob = this.add.graphics();
    knob.fillStyle(0x000000, 0.3);
    knob.fillCircle(0, scaledInt(this.layoutScale, 1), knobRadius + 1);
    knob.fillStyle(SWITCH_COLORS.knobOff, 1);
    knob.fillCircle(0, 0, knobRadius);
    card.frame.add(knob);

    // State word — the switch never reads ambiguously even at a glance.
    const stateLabel = this.add.text(
      trackCenterX - trackWidth / 2 - scaledInt(this.layoutScale, 10), y, '', {
        fontSize: scaledFontPx(this.fontScale, 12),
        color: TEXT_COLORS.muted,
        fontFamily: FONT_FAMILY,
        fontStyle: 'bold',
      }).setOrigin(1, 0.5);
    card.frame.add(stateLabel);

    const drawTrack = (enabled: boolean, focused: boolean) => {
      const halfW = trackWidth / 2;
      const halfH = trackHeight / 2;
      track.clear();
      track.fillStyle(enabled ? SWITCH_COLORS.trackOn : SWITCH_COLORS.trackOff, 1);
      track.fillRoundedRect(trackCenterX - halfW, y - halfH, trackWidth, trackHeight, halfH);
      if (focused) {
        track.lineStyle(2, PILL_PALETTE.focusBorder, 1);
      } else {
        track.lineStyle(1, enabled ? SWITCH_COLORS.trackOn : SWITCH_COLORS.trackBorderOff, 0.9);
      }
      track.strokeRoundedRect(trackCenterX - halfW, y - halfH, trackWidth, trackHeight, halfH);
    };

    const drawKnob = (enabled: boolean) => {
      knob.clear();
      knob.fillStyle(0x000000, 0.3);
      knob.fillCircle(0, scaledInt(this.layoutScale, 1), knobRadius + 1);
      knob.fillStyle(enabled ? SWITCH_COLORS.knobOn : SWITCH_COLORS.knobOff, 1);
      knob.fillCircle(0, 0, knobRadius);
    };

    const knobX = (enabled: boolean) => trackCenterX + (enabled ? knobTravel : -knobTravel);

    let currentEnabled = initialEnabled;
    let currentFocused = false;

    const applyState = (animateKnob: boolean) => {
      drawTrack(currentEnabled, currentFocused);
      drawKnob(currentEnabled);
      stateLabel.setText(currentEnabled ? 'ON' : 'OFF');
      stateLabel.setColor(currentEnabled ? SWITCH_COLORS.labelOn : TEXT_COLORS.muted);
      // Read reduced motion live — this very control toggles it, and the
      // switch should honor the value the click just committed.
      if (animateKnob && !getSettingsManager().isReducedMotionEnabled()) {
        this.tweens.killTweensOf(knob);
        this.tweens.add({
          targets: knob,
          x: knobX(currentEnabled),
          duration: 120,
          ease: 'Sine.easeOut',
        });
      } else if (this.tweens.getTweensOf(knob).length === 0) {
        // Focus repaints call through here every hover — don't snap a knob
        // that's mid-slide (any in-flight tween already targets this state).
        knob.setX(knobX(currentEnabled));
      }
    };

    knob.setPosition(knobX(initialEnabled), y);
    applyState(false);

    const hitZone = this.add.zone(trackCenterX, y, trackWidth + scaledInt(this.layoutScale, 12), trackHeight + scaledInt(this.layoutScale, 10))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    card.frame.add(hitZone);
    hitZone.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.focusZone = zone;
      onToggle();
    });
    hitZone.on('pointerover', () => {
      this.focusZone = zone;
      this.refreshAllFocusVisuals();
    });

    return {
      refresh: (enabled: boolean) => {
        const changed = enabled !== currentEnabled;
        currentEnabled = enabled;
        applyState(changed);
      },
      setFocused: (focused: boolean) => {
        currentFocused = focused;
        applyState(false);
      },
    };
  }

  // ── Volume row ────────────────────────────────────────────────────────────

  private addVolumeRow(card: MenuCard, rightAlignX: number, y: number, zone: FocusZone, initial01: number, onChange: (delta: number) => void): VolumeControl {
    const buttonWidth = scaledInt(this.layoutScale, 24);
    const buttonHeight = scaledInt(this.layoutScale, 26);
    const barWidth = scaledInt(this.layoutScale, 130);
    const barHeight = scaledInt(this.layoutScale, 10);
    const percentTextWidth = scaledInt(this.layoutScale, 44);
    const gap = scaledInt(this.layoutScale, 8);

    const plusX = rightAlignX - buttonWidth / 2;
    const percentX = plusX - buttonWidth / 2 - gap - percentTextWidth / 2;
    const barEndX = percentX - percentTextWidth / 2 - gap;
    const barCenterX = barEndX - barWidth / 2;
    const minusX = barCenterX - barWidth / 2 - gap - buttonWidth / 2;

    const minusButton = this.makeStepperButton(card, minusX, y, zone, '−', () => onChange(-0.1));
    const plusButton = this.makeStepperButton(card, plusX, y, zone, '+', () => onChange(0.1));

    const bar = this.add.graphics();
    card.frame.add(bar);

    const percentLabel = this.add.text(percentX, y, '', {
      fontSize: scaledFontPx(this.fontScale, 13),
      color: TEXT_COLORS.body,
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    card.frame.add(percentLabel);

    const drawBar = (percent01: number, focused: boolean) => {
      bar.clear();
      const segments = 10;
      const filled = Math.round(Phaser.Math.Clamp(percent01, 0, 1) * segments);
      const segGap = scaledInt(this.layoutScale, 2);
      const segWidth = (barWidth - segGap * (segments - 1)) / segments;
      for (let i = 0; i < segments; i++) {
        const segX = barCenterX - barWidth / 2 + i * (segWidth + segGap);
        const isFilled = i < filled;
        bar.fillStyle(isFilled ? (focused ? ACCENT_COLORS.focus : ACCENT_COLORS.primary) : 0x2a3450, 1);
        bar.fillRoundedRect(segX, y - barHeight / 2, segWidth, barHeight, 2);
      }
    };

    let currentPercent = Phaser.Math.Clamp(initial01, 0, 1);
    let currentFocused = false;

    const applyState = () => {
      drawBar(currentPercent, currentFocused);
      percentLabel.setText(`${Math.round(currentPercent * 100)}%`);
      const color = currentFocused ? ACCENT_COLORS_STR.focus : TEXT_COLORS.muted;
      minusButton.setColor(color);
      plusButton.setColor(color);
    };
    applyState();
    void buttonWidth; void buttonHeight;

    return {
      refresh(percent01: number) {
        currentPercent = Phaser.Math.Clamp(percent01, 0, 1);
        applyState();
      },
      setFocused(focused: boolean) {
        currentFocused = focused;
        applyState();
      },
    };
  }

  private addStepperRow(card: MenuCard, rightAlignX: number, y: number, zone: FocusZone, getValueLabel: () => string, onChange: (delta: number) => void): StepperHandles {
    const buttonWidth = scaledInt(this.layoutScale, 24);
    const valueWidth = scaledInt(this.layoutScale, 62);
    const gap = scaledInt(this.layoutScale, 6);

    const plusX = rightAlignX - buttonWidth / 2;
    const valueX = plusX - buttonWidth / 2 - gap - valueWidth / 2;
    const minusX = valueX - valueWidth / 2 - gap - buttonWidth / 2;

    const minusButton = this.makeStepperButton(card, minusX, y, zone, '−', () => onChange(-0.1));
    const plusButton = this.makeStepperButton(card, plusX, y, zone, '+', () => onChange(0.1));

    const valueLabel = this.add.text(valueX, y, getValueLabel(), {
      fontSize: scaledFontPx(this.fontScale, 14),
      color: TEXT_COLORS.body,
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    card.frame.add(valueLabel);

    return { minusButton, plusButton, valueLabel };
  }

  private makeStepperButton(card: MenuCard, x: number, y: number, zone: FocusZone, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const text = this.add.text(x, y, label, {
      fontSize: scaledFontPx(this.fontScale, 18),
      color: TEXT_COLORS.muted,
      fontFamily: FONT_FAMILY,
      fontStyle: 'bold',
      backgroundColor: '#1c2538',
      padding: { left: 6, right: 6, top: 1, bottom: 1 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    card.frame.add(text);

    text.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.focusZone = zone;
      onClick();
    });
    text.on('pointerover', () => {
      this.focusZone = zone;
      this.refreshAllFocusVisuals();
    });
    addButtonInteraction(this, text);
    return text;
  }

  // ── Segmented control ─────────────────────────────────────────────────────

  private addSegmented<T extends string>(
    card: MenuCard,
    rightAlignX: number,
    y: number,
    zone: FocusZone,
    options: { value: T; label: string }[],
    initialValue: T,
    onSelect: (value: T, index: number) => void,
  ): SegmentedControl<T> {
    const totalWidth = scaledInt(this.layoutScale, 256);
    const gap = scaledInt(this.layoutScale, 5);
    const pillHeight = scaledInt(this.layoutScale, 24);
    const pillWidth = (totalWidth - gap * (options.length - 1)) / options.length;

    const pills: { value: T; pill: PillHandle }[] = [];
    const startX = rightAlignX - totalWidth;

    options.forEach((option, index) => {
      const px = startX + index * (pillWidth + gap) + pillWidth / 2;
      const pill = this.createPill(card.frame, px, y, pillWidth, pillHeight, option.label,
        PILL_PALETTE.neutral,
        () => {
          this.focusZone = zone;
          onSelect(option.value, index);
        },
        () => {
          this.focusZone = zone;
          this.setSegmentedFocusIndex(zone, index);
          this.refreshAllFocusVisuals();
        });
      pills.push({ value: option.value, pill });
    });

    const applyState = (activeValue: T, focusedIndex: number | null) => {
      pills.forEach(({ value, pill }, index) => {
        const isActive = value === activeValue;
        const isFocused = focusedIndex === index;
        const palette = isActive ? PILL_PALETTE.neutralActive : PILL_PALETTE.neutral;
        this.drawPill(pill.background, pill.width, pill.height, palette.fill,
          isFocused ? PILL_PALETTE.focusBorder : palette.border, isFocused);
        pill.label.setColor(palette.text);
      });
    };

    applyState(initialValue, null);

    return {
      refresh(activeValue: T, focusedIndex: number | null) {
        applyState(activeValue, focusedIndex);
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Focus refresh
  // ──────────────────────────────────────────────────────────────────────────

  private refreshAllFocusVisuals(): void {
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();

    const toggleStates: { zone: FocusZone; enabled: boolean }[] = [
      { zone: 'sfx', enabled: settingsManager.isSfxEnabled() },
      { zone: 'bgm', enabled: musicManager.getPlaybackMode() !== 'off' },
      { zone: 'screenShake', enabled: settingsManager.isScreenShakeEnabled() },
      { zone: 'reducedMotion', enabled: settingsManager.isReducedMotionEnabled() },
      { zone: 'gridEffects', enabled: settingsManager.isGridEffectsEnabled() },
      { zone: 'fpsCounter', enabled: settingsManager.isFpsCounterEnabled() },
      { zone: 'highContrast', enabled: settingsManager.isHighContrastEnabled() },
      { zone: 'minimap', enabled: settingsManager.isMinimapEnabled() },
      { zone: 'statusText', enabled: settingsManager.isStatusTextEnabled() },
    ];
    for (const { zone, enabled } of toggleStates) {
      const toggle = this.toggles[zone];
      if (!toggle) continue;
      toggle.setFocused(this.focusZone === zone);
      toggle.refresh(enabled);
    }

    this.volumes['sfxVolume']?.setFocused(this.focusZone === 'sfxVolume');
    this.volumes['sfxVolume']?.refresh(settingsManager.getSfxVolume());
    this.volumes['bgmVolume']?.setFocused(this.focusZone === 'bgmVolume');
    this.volumes['bgmVolume']?.refresh(musicManager.getVolume());

    if (this.uiScaleHandles) {
      this.uiScaleHandles.valueLabel.setText(`${Math.round(settingsManager.getUiScale() * 100)}%`);
      const focused = this.focusZone === 'uiScale';
      this.uiScaleHandles.minusButton.setColor(focused ? ACCENT_COLORS_STR.focus : TEXT_COLORS.muted);
      this.uiScaleHandles.plusButton.setColor(focused ? ACCENT_COLORS_STR.focus : TEXT_COLORS.muted);
    }

    this.playbackSegmented?.refresh(this.resolvePlaybackValue(),
      this.focusZone === 'playbackMode' ? this.playbackModeIndex : null);
    this.damageNumbersSegmented?.refresh(settingsManager.getDamageNumbersMode(),
      this.focusZone === 'damageNumbers' ? this.damageNumberIndex : null);
    this.colorblindSegmented?.refresh(settingsManager.getColorblindMode(),
      this.focusZone === 'colorblind' ? this.colorblindModeIndex : null);

    this.musicTracksButton?.setFocusState(this.focusZone === 'musicTracks');
    this.exportProfileButton?.setFocusState(this.focusZone === 'exportProfile');
    this.importProfileButton?.setFocusState(this.focusZone === 'importProfile');
    this.resetDataButton?.setFocusState(this.focusZone === 'resetData');
    this.backButton?.setFocusState(this.focusZone === 'back');
  }

  private setSegmentedFocusIndex(zone: FocusZone, index: number): void {
    if (zone === 'playbackMode') this.playbackModeIndex = index;
    else if (zone === 'damageNumbers') this.damageNumberIndex = index;
    else if (zone === 'colorblind') this.colorblindModeIndex = index;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────────────────────

  private buildMenuNavigator(): void {
    if (this.menuNavigator) this.menuNavigator.destroy();

    const orderedZones: FocusZone[] = [
      'sfx', 'sfxVolume', 'bgm', 'bgmVolume', 'playbackMode', 'musicTracks',
      'damageNumbers', 'statusText',
      'screenShake', 'reducedMotion', 'gridEffects', 'fpsCounter',
      'colorblind', 'highContrast', 'minimap',
      'uiScale', 'exportProfile', 'importProfile', 'resetData',
      'back',
    ];

    // Zones whose value is adjusted with left/right (volume rows, UI scale,
    // segmented pills). Routed through the navigator so keyboard AND
    // gamepad D-pad/stick horizontal input both work.
    const horizontalZones = new Set<FocusZone>([
      'sfxVolume', 'bgmVolume', 'uiScale', 'playbackMode', 'damageNumbers', 'colorblind',
    ]);

    const navigableItems = orderedZones.map((zone) => {
      const item: NavigableItem = {
        onFocus: () => {
          this.focusZone = zone;
          this.refreshAllFocusVisuals();
        },
        onBlur: () => {
          this.refreshAllFocusVisuals();
        },
        onActivate: () => {
          this.activateCurrentSelection();
        },
      };
      if (horizontalZones.has(zone)) {
        item.onLeft = () => this.navigateLeft();
        item.onRight = () => this.navigateRight();
      }
      return item;
    });

    const currentZoneIndex = orderedZones.indexOf(this.focusZone);

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: 1,
      wrap: true,
      onCancel: () => this.goBack(),
      initialIndex: currentZoneIndex >= 0 ? currentZoneIndex : 0,
    });
  }

  private navigateLeft(): void {
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();
    switch (this.focusZone) {
      case 'sfxVolume':
        settingsManager.setSfxVolume(settingsManager.getSfxVolume() - 0.1);
        break;
      case 'bgmVolume':
        musicManager.setVolume(musicManager.getVolume() - 0.1);
        break;
      case 'uiScale':
        settingsManager.setUiScale(settingsManager.getUiScale() - 0.1);
        this.scene.restart({ returnTo: this.returnTo });
        return;
      case 'playbackMode':
        this.playbackModeIndex = Math.max(0, this.playbackModeIndex - 1);
        break;
      case 'damageNumbers':
        this.damageNumberIndex = Math.max(0, this.damageNumberIndex - 1);
        break;
      case 'colorblind':
        this.colorblindModeIndex = Math.max(0, this.colorblindModeIndex - 1);
        break;
    }
    this.refreshAllFocusVisuals();
  }

  private navigateRight(): void {
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();
    switch (this.focusZone) {
      case 'sfxVolume':
        settingsManager.setSfxVolume(settingsManager.getSfxVolume() + 0.1);
        break;
      case 'bgmVolume':
        musicManager.setVolume(musicManager.getVolume() + 0.1);
        break;
      case 'uiScale':
        settingsManager.setUiScale(settingsManager.getUiScale() + 0.1);
        this.scene.restart({ returnTo: this.returnTo });
        return;
      case 'playbackMode':
        this.playbackModeIndex = Math.min(1, this.playbackModeIndex + 1);
        break;
      case 'damageNumbers':
        this.damageNumberIndex = Math.min(3, this.damageNumberIndex + 1);
        break;
      case 'colorblind':
        this.colorblindModeIndex = Math.min(COLORBLIND_MODE_OPTIONS.length - 1, this.colorblindModeIndex + 1);
        break;
    }
    this.refreshAllFocusVisuals();
  }

  private activateCurrentSelection(): void {
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();

    switch (this.focusZone) {
      case 'sfx':
        settingsManager.setSfxEnabled(!settingsManager.isSfxEnabled());
        break;
      case 'bgm':
        if (musicManager.getPlaybackMode() === 'off') {
          musicManager.setPlaybackMode('sequential');
          musicManager.play();
        } else {
          musicManager.setPlaybackMode('off');
          musicManager.stop();
        }
        break;
      case 'playbackMode': {
        const modes: ('sequential' | 'shuffle')[] = ['sequential', 'shuffle'];
        const wasOff = musicManager.getPlaybackMode() === 'off';
        musicManager.setPlaybackMode(modes[this.playbackModeIndex]);
        if (wasOff) musicManager.play();
        break;
      }
      case 'musicTracks':
        transitionToScene(this, 'MusicSettingsScene', { returnTo: 'SettingsScene', originalReturnTo: this.returnTo });
        return;
      case 'screenShake':
        settingsManager.setScreenShakeEnabled(!settingsManager.isScreenShakeEnabled());
        break;
      case 'reducedMotion':
        settingsManager.setReducedMotion(!settingsManager.isReducedMotionEnabled());
        break;
      case 'gridEffects':
        settingsManager.setGridEffectsEnabled(!settingsManager.isGridEffectsEnabled());
        break;
      case 'fpsCounter':
        settingsManager.setFpsCounterEnabled(!settingsManager.isFpsCounterEnabled());
        break;
      case 'colorblind':
        settingsManager.setColorblindMode(colorblindModeAtIndex(this.colorblindModeIndex));
        break;
      case 'highContrast':
        settingsManager.setHighContrast(!settingsManager.isHighContrastEnabled());
        break;
      case 'minimap':
        settingsManager.setMinimapEnabled(!settingsManager.isMinimapEnabled());
        break;
      case 'damageNumbers': {
        const modes: DamageNumbersMode[] = ['all', 'crits', 'perfect_crits', 'off'];
        settingsManager.setDamageNumbersMode(modes[this.damageNumberIndex]);
        break;
      }
      case 'statusText':
        settingsManager.setStatusTextEnabled(!settingsManager.isStatusTextEnabled());
        break;
      case 'exportProfile':
        void this.openProfileExport();
        return;
      case 'importProfile':
        this.openProfileImport();
        return;
      case 'resetData':
        this.showResetConfirmation();
        return;
      case 'back':
        this.goBack();
        return;
    }
    this.refreshAllFocusVisuals();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reset confirmation overlay
  // ──────────────────────────────────────────────────────────────────────────

  private showResetConfirmation(): void {
    if (this.confirmOverlay.length > 0) return;

    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;

    const dimBg = this.add.rectangle(centerX, centerY, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.75)
      .setInteractive()
      .setDepth(100);

    const dialogCard = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width: scaledInt(this.layoutScale, 460),
      height: scaledInt(this.layoutScale, 240),
      bodyFillColor: BODY_COLORS.danger,
      accentColor: ACCENT_COLORS.danger,
      bannerHeight: scaledInt(this.layoutScale, 38),
      borderWidth: 3,
      borderColor: ACCENT_COLORS.danger,
      cornerRadius: 8,
      shadowOffsetX: 6,
      shadowOffsetY: 14,
      shadowAlpha: 0.7,
      interactive: false,
    });
    dialogCard.container.setDepth(101);

    const title = makeDisplayText(this, 0, -dialogCard.height / 2 + scaledInt(this.layoutScale, 19), 'RESET ALL DATA?', {
      fontSize: 20,
      color: '#101018',
      strokeWidth: 0,
      letterSpacing: 3,
    });
    title.setFontSize(scaledFontPx(this.fontScale, 20));
    dialogCard.frame.add(title);

    const description = makeBodyText(this, 0, -scaledInt(this.layoutScale, 10),
      'This will permanently erase all progress,\nupgrades, achievements, and settings.\nThis cannot be undone.', {
        fontSize: scaledInt(this.fontScale, 13),
        color: TEXT_COLORS.body,
        align: 'center',
      });
    description.setOrigin(0.5, 0.5);
    description.setLineSpacing(2);
    dialogCard.frame.add(description);

    const confirmButton = createMenuButton({
      scene: this,
      x: -scaledInt(this.layoutScale, 90),
      y: scaledInt(this.layoutScale, 68),
      width: scaledInt(this.layoutScale, 150),
      height: scaledInt(this.layoutScale, 44),
      label: 'CONFIRM',
      variant: 'danger',
      fontSize: scaledInt(this.fontScale, 16),
      onActivate: () => this.resetAllStorageAndReload(),
    });
    dialogCard.frame.add(confirmButton.container);
    confirmButton.card.container.setDepth(102);

    const cancelButton = createMenuButton({
      scene: this,
      x: scaledInt(this.layoutScale, 90),
      y: scaledInt(this.layoutScale, 68),
      width: scaledInt(this.layoutScale, 150),
      height: scaledInt(this.layoutScale, 44),
      label: 'CANCEL',
      variant: 'neutral',
      fontSize: scaledInt(this.fontScale, 16),
      onActivate: () => this.dismissResetConfirmation(),
    });
    dialogCard.frame.add(cancelButton.container);
    cancelButton.card.container.setDepth(102);

    this.confirmButtonRef = confirmButton;
    this.cancelButtonRef = cancelButton;

    this.confirmOverlay = [dimBg, dialogCard.container];
    this.menuButtons.push(confirmButton, cancelButton);

    // The overlay owns input until dismissed — suspend the main navigator and
    // hand keyboard + gamepad to a dedicated CONFIRM/CANCEL navigator
    // (mirrors BootScene's new-game confirmation).
    this.menuNavigator?.setEnabled(false);
    this.confirmNavigator = new MenuNavigator({
      scene: this,
      columns: 2,
      initialIndex: 1,
      items: [
        {
          onFocus: () => {
            this.confirmFocusIndex = 0;
            this.updateConfirmFocusVisuals();
          },
          onBlur: () => this.updateConfirmFocusVisuals(),
          onActivate: () => this.resetAllStorageAndReload(),
        },
        {
          onFocus: () => {
            this.confirmFocusIndex = 1;
            this.updateConfirmFocusVisuals();
          },
          onBlur: () => this.updateConfirmFocusVisuals(),
          onActivate: () => this.dismissResetConfirmation(),
        },
      ],
      onCancel: () => this.dismissResetConfirmation(),
    });
  }

  private updateConfirmFocusVisuals(): void {
    this.confirmButtonRef?.setFocusState(this.confirmFocusIndex === 0);
    this.cancelButtonRef?.setFocusState(this.confirmFocusIndex === 1);
  }

  private dismissResetConfirmation(): void {
    this.confirmNavigator?.destroy();
    this.confirmNavigator = null;
    for (const obj of this.confirmOverlay) obj.destroy();
    this.confirmOverlay = [];
    if (this.confirmButtonRef) {
      this.menuButtons = this.menuButtons.filter((b) => b !== this.confirmButtonRef && b !== this.cancelButtonRef);
      this.confirmButtonRef.destroy();
      this.cancelButtonRef?.destroy();
    }
    this.confirmButtonRef = null;
    this.cancelButtonRef = null;
    this.menuNavigator?.setEnabled(true);
  }

  private resetAllStorageAndReload(): void {
    for (const key of ALL_STORAGE_KEYS) SecureStorage.removeItem(key);
    localStorage.clear();
    window.location.reload();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private indexOfDamageMode(mode: DamageNumbersMode): number {
    const modes: DamageNumbersMode[] = ['all', 'crits', 'perfect_crits', 'off'];
    return modes.indexOf(mode);
  }

  private resolvePlaybackValue(): 'sequential' | 'shuffle' {
    const mode = getMusicManager().getPlaybackMode();
    return mode === 'shuffle' ? 'shuffle' : 'sequential';
  }

  private goBack(): void {
    if (this.returnTo === 'GameScene') {
      const gameScene = this.scene.get('GameScene') as GameScene;
      // A changed UI scale can't be applied to the live HUD in place —
      // GameScene round-trips its save-restore path to rebuild every in-run
      // surface at the new scale, then reopens the pause menu.
      const uiScaleChanged = getSettingsManager().getUiScale() !== this.uiScaleOnEntry;
      if (uiScaleChanged && gameScene?.applyUiScaleChange) {
        gameScene.applyUiScaleChange();
        this.scene.stop();
        return;
      }
      if (gameScene?.showPauseMenuFromSettings) {
        gameScene.showPauseMenuFromSettings();
      }
      this.scene.resume('GameScene');
      this.scene.stop();
    } else {
      transitionToScene(this, 'BootScene');
    }
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    if (this.confirmNavigator) {
      this.confirmNavigator.destroy();
      this.confirmNavigator = null;
    }
    if (this.bgUpdateHandler) {
      this.events.off('update', this.bgUpdateHandler);
      this.bgUpdateHandler = null;
    }
    this.menuOverlay?.destroy();
    this.menuOverlay = null;
    for (const btn of this.menuButtons) btn.destroy();
    this.menuButtons = [];
    this.idleCards = [];
    this.tweens.killAll();
    this.profileOverlayTeardown?.();
    this.profileOverlayTeardown = null;
  }
}
