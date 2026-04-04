/**
 * SettingsScene - Unified settings UI accessible from both BootScene and GameScene pause menu.
 * Uses an overlay approach so it doesn't interrupt gameplay when accessed during a run.
 */

import Phaser from 'phaser';
import { getSettingsManager, DamageNumbersMode } from '../../settings';
import { getMusicManager } from '../../audio/MusicManager';
import type { GameScene } from './GameScene';
import { fadeIn, addButtonInteraction } from '../../utils/SceneTransition';
import { SecureStorage, ALL_STORAGE_KEYS } from '../../storage';
import { computeMenuLayoutScale, computeMenuFontScale, scaledFontPx, scaledInt } from '../../utils/HudScale';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator } from '../../input/MenuNavigator';

type FocusZone = 'sfx' | 'sfxVolume' | 'bgm' | 'bgmVolume' | 'playbackMode' | 'musicTracks' | 'screenShake' | 'reducedMotion' | 'gridEffects' | 'fpsCounter' | 'uiScale' | 'damageNumbers' | 'statusText' | 'resetData' | 'back';

interface SettingsSceneData {
  returnTo: 'BootScene' | 'GameScene';
}

export class SettingsScene extends Phaser.Scene {
  private returnTo: 'BootScene' | 'GameScene' = 'BootScene';

  // UI Elements
  private sfxToggle!: Phaser.GameObjects.Text;
  private sfxVolumeDown!: Phaser.GameObjects.Text;
  private sfxVolumeUp!: Phaser.GameObjects.Text;
  private sfxVolumeText!: Phaser.GameObjects.Text;
  private bgmToggle!: Phaser.GameObjects.Text;
  private bgmVolumeDown!: Phaser.GameObjects.Text;
  private bgmVolumeUp!: Phaser.GameObjects.Text;
  private bgmVolumeText!: Phaser.GameObjects.Text;
  private musicTracksButton!: Phaser.GameObjects.Text;
  private playbackModeButtons: Phaser.GameObjects.Text[] = [];
  private screenShakeToggle!: Phaser.GameObjects.Text;
  private reducedMotionToggle!: Phaser.GameObjects.Text;
  private gridEffectsToggle!: Phaser.GameObjects.Text;
  private fpsCounterToggle!: Phaser.GameObjects.Text;
  private uiScaleDown!: Phaser.GameObjects.Text;
  private uiScaleUp!: Phaser.GameObjects.Text;
  private uiScaleText!: Phaser.GameObjects.Text;
  private damageNumberButtons: Phaser.GameObjects.Text[] = [];
  private statusTextToggle!: Phaser.GameObjects.Text;
  private resetDataButton!: Phaser.GameObjects.Text;
  private backButton!: Phaser.GameObjects.Text;

  private soundManager!: SoundManager;

  // Confirmation overlay elements
  private confirmOverlay: Phaser.GameObjects.GameObject[] = [];
  private confirmFocusIndex: number = 1; // 0 = Confirm, 1 = Cancel (default to Cancel for safety)
  private confirmButtonRef: Phaser.GameObjects.Text | null = null;
  private cancelButtonRef: Phaser.GameObjects.Text | null = null;

  // Navigation state
  private focusZone: FocusZone = 'sfx';
  private damageNumberIndex: number = 0;
  private playbackModeIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;
  private layoutScale: number = 1;
  private fontScale: number = 1;

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

    // Compute scaling for responsive layout on phones
    this.layoutScale = computeMenuLayoutScale(this.scale.width, this.scale.height);
    this.fontScale = computeMenuFontScale(this.scale.width, this.scale.height, settingsManager.getUiScale());
    const ls = this.layoutScale;
    const fs = this.fontScale;

    // Reset state
    this.damageNumberButtons = [];
    this.playbackModeButtons = [];
    this.focusZone = 'sfx';
    this.damageNumberIndex = this.getDamageNumberModeIndex(settingsManager.getDamageNumbersMode());
    this.playbackModeIndex = this.getPlaybackModeIndex(musicManager.getPlaybackMode());

    fadeIn(this, 150);

    // Semi-transparent background
    this.add.rectangle(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      this.cameras.main.width,
      this.cameras.main.height,
      0x000000,
      0.85
    );

    // Title
    this.add.text(centerX, scaledInt(ls, 30), 'SETTINGS', {
      fontSize: scaledFontPx(fs, 36),
      color: '#ffdd44',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    const contentLeftX = scaledInt(ls, 340);
    let currentY = scaledInt(ls, 80);
    const rowSpacing = scaledInt(ls, 35);
    const sectionSpacing = scaledInt(ls, 50);

    // ═══════════════════════════════════════════════════════════════════════
    // AUDIO Section
    // ═══════════════════════════════════════════════════════════════════════
    this.add.text(centerX, currentY, '═══════════════════ AUDIO ═══════════════════', {
      fontSize: scaledFontPx(fs, 14),
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    currentY += rowSpacing;

    // SFX Toggle + Volume
    this.add.text(contentLeftX, currentY, 'SFX', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.sfxToggle = this.createToggle(contentLeftX + scaledInt(ls, 100), currentY, settingsManager.isSfxEnabled(), () => {
      const newValue = !settingsManager.isSfxEnabled();
      settingsManager.setSfxEnabled(newValue);
      this.updateSfxToggle();
    });
    this.sfxToggle.setData('zone', 'sfx');

    this.add.text(contentLeftX + scaledInt(ls, 250), currentY, 'Volume', {
      fontSize: scaledFontPx(fs, 16),
      color: '#aaaaaa',
      fontFamily: 'Arial',
    });

    this.sfxVolumeDown = this.createButton(contentLeftX + scaledInt(ls, 340), currentY, '[ - ]', () => {
      settingsManager.setSfxVolume(settingsManager.getSfxVolume() - 0.1);
      this.updateSfxVolume();
    });
    this.sfxVolumeDown.setData('zone', 'sfxVolume');

    this.sfxVolumeText = this.add.text(contentLeftX + scaledInt(ls, 400), currentY, `${Math.round(settingsManager.getSfxVolume() * 100)}%`, {
      fontSize: scaledFontPx(fs, 16),
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0);

    this.sfxVolumeUp = this.createButton(contentLeftX + scaledInt(ls, 460), currentY, '[ + ]', () => {
      settingsManager.setSfxVolume(settingsManager.getSfxVolume() + 0.1);
      this.updateSfxVolume();
    });
    this.sfxVolumeUp.setData('zone', 'sfxVolume');

    currentY += rowSpacing;

    // BGM Toggle + Volume
    this.add.text(contentLeftX, currentY, 'BGM', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    const bgmEnabled = musicManager.getPlaybackMode() !== 'off';
    this.bgmToggle = this.createToggle(contentLeftX + scaledInt(ls, 100), currentY, bgmEnabled, () => {
      const currentMode = musicManager.getPlaybackMode();
      if (currentMode === 'off') {
        musicManager.setPlaybackMode('sequential');
        musicManager.play();
      } else {
        musicManager.setPlaybackMode('off');
        musicManager.stop();
      }
      this.updateBgmToggle();
    });
    this.bgmToggle.setData('zone', 'bgm');

    this.add.text(contentLeftX + scaledInt(ls, 250), currentY, 'Volume', {
      fontSize: scaledFontPx(fs, 16),
      color: '#aaaaaa',
      fontFamily: 'Arial',
    });

    this.bgmVolumeDown = this.createButton(contentLeftX + scaledInt(ls, 340), currentY, '[ - ]', () => {
      musicManager.setVolume(musicManager.getVolume() - 0.1);
      this.updateBgmVolume();
    });
    this.bgmVolumeDown.setData('zone', 'bgmVolume');

    this.bgmVolumeText = this.add.text(contentLeftX + scaledInt(ls, 400), currentY, `${Math.round(musicManager.getVolume() * 100)}%`, {
      fontSize: scaledFontPx(fs, 16),
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0);

    this.bgmVolumeUp = this.createButton(contentLeftX + scaledInt(ls, 460), currentY, '[ + ]', () => {
      musicManager.setVolume(musicManager.getVolume() + 0.1);
      this.updateBgmVolume();
    });
    this.bgmVolumeUp.setData('zone', 'bgmVolume');

    currentY += rowSpacing;

    // Playback Mode selector (Sequential / Shuffle)
    this.add.text(contentLeftX, currentY, 'Playback', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    const playbackModes: { mode: 'sequential' | 'shuffle' | 'off'; label: string }[] = [
      { mode: 'sequential', label: 'Sequential' },
      { mode: 'shuffle', label: 'Shuffle' },
    ];

    const playbackModeStartX = contentLeftX + scaledInt(ls, 120);
    playbackModes.forEach((item, index) => {
      const buttonX = playbackModeStartX + index * scaledInt(ls, 100);
      const currentMode = musicManager.getPlaybackMode();
      const isActive = currentMode === item.mode || (currentMode === 'off' && item.mode === 'sequential');

      const button = this.add.text(buttonX, currentY, `[${item.label}]`, {
        fontSize: scaledFontPx(fs, 14),
        color: isActive ? '#ffdd44' : '#888888',
        fontFamily: 'Arial',
      }).setInteractive({ useHandCursor: true });

      button.setData('zone', 'playbackMode');
      button.setData('index', index);

      button.on('pointerover', () => {
        this.focusZone = 'playbackMode';
        this.playbackModeIndex = index;
        this.updateFocusVisuals();
      });

      button.on('pointerdown', () => {
        const wasOff = musicManager.getPlaybackMode() === 'off';
        musicManager.setPlaybackMode(item.mode);
        this.playbackModeIndex = index;
        this.updatePlaybackModeButtons();
        // If music was off, also start playing
        if (wasOff) {
          musicManager.play();
          this.updateBgmToggle();
        }
      });

      addButtonInteraction(this, button);
      this.playbackModeButtons.push(button);
    });

    currentY += scaledInt(ls, 40);

    // Music Track Selection button
    this.musicTracksButton = this.add.text(centerX, currentY, '[ Music Track Selection ]', {
      fontSize: scaledFontPx(fs, 16),
      color: '#888888',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.musicTracksButton.setData('zone', 'musicTracks');
    this.musicTracksButton.on('pointerover', () => {
      this.focusZone = 'musicTracks';
      this.updateFocusVisuals();
    });
    this.musicTracksButton.on('pointerdown', () => {
      this.scene.start('MusicSettingsScene', { returnTo: 'SettingsScene', originalReturnTo: this.returnTo });
    });
    addButtonInteraction(this, this.musicTracksButton);

    currentY += sectionSpacing;

    // ═══════════════════════════════════════════════════════════════════════
    // VISUALS Section
    // ═══════════════════════════════════════════════════════════════════════
    this.add.text(centerX, currentY, '═══════════════════ VISUALS ═════════════════', {
      fontSize: scaledFontPx(fs, 14),
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    currentY += rowSpacing;

    // Screen Shake Toggle
    this.add.text(contentLeftX, currentY, 'Screen Shake', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.screenShakeToggle = this.createToggle(contentLeftX + scaledInt(ls, 180), currentY, settingsManager.isScreenShakeEnabled(), () => {
      const newValue = !settingsManager.isScreenShakeEnabled();
      settingsManager.setScreenShakeEnabled(newValue);
      this.updateScreenShakeToggle();
    });
    this.screenShakeToggle.setData('zone', 'screenShake');

    currentY += rowSpacing;

    // Reduced Motion Toggle
    this.add.text(contentLeftX, currentY, 'Reduced Motion', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.reducedMotionToggle = this.createToggle(contentLeftX + scaledInt(ls, 180), currentY, settingsManager.isReducedMotionEnabled(), () => {
      const newValue = !settingsManager.isReducedMotionEnabled();
      settingsManager.setReducedMotion(newValue);
      this.updateReducedMotionToggle();
    });
    this.reducedMotionToggle.setData('zone', 'reducedMotion');

    currentY += rowSpacing;

    // Grid Effects Toggle
    this.add.text(contentLeftX, currentY, 'Grid Effects', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.gridEffectsToggle = this.createToggle(contentLeftX + scaledInt(ls, 180), currentY, settingsManager.isGridEffectsEnabled(), () => {
      const newValue = !settingsManager.isGridEffectsEnabled();
      settingsManager.setGridEffectsEnabled(newValue);
      this.updateGridEffectsToggle();
    });
    this.gridEffectsToggle.setData('zone', 'gridEffects');

    currentY += rowSpacing;

    // FPS Counter Toggle
    this.add.text(contentLeftX, currentY, 'FPS Counter', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.fpsCounterToggle = this.createToggle(contentLeftX + scaledInt(ls, 180), currentY, settingsManager.isFpsCounterEnabled(), () => {
      const newValue = !settingsManager.isFpsCounterEnabled();
      settingsManager.setFpsCounterEnabled(newValue);
      this.updateFpsCounterToggle();
    });
    this.fpsCounterToggle.setData('zone', 'fpsCounter');

    currentY += rowSpacing;

    // UI Scale slider
    this.add.text(contentLeftX, currentY, 'UI Scale', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.uiScaleDown = this.createButton(contentLeftX + scaledInt(ls, 180), currentY, '[ - ]', () => {
      settingsManager.setUiScale(settingsManager.getUiScale() - 0.1);
      this.scene.restart({ returnTo: this.returnTo });
    });
    this.uiScaleDown.setData('zone', 'uiScale');

    this.uiScaleText = this.add.text(contentLeftX + scaledInt(ls, 240), currentY, `${Math.round(settingsManager.getUiScale() * 100)}%`, {
      fontSize: scaledFontPx(fs, 16),
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0);

    this.uiScaleUp = this.createButton(contentLeftX + scaledInt(ls, 300), currentY, '[ + ]', () => {
      settingsManager.setUiScale(settingsManager.getUiScale() + 0.1);
      this.scene.restart({ returnTo: this.returnTo });
    });
    this.uiScaleUp.setData('zone', 'uiScale');

    currentY += sectionSpacing;

    // ═══════════════════════════════════════════════════════════════════════
    // COMBAT TEXT Section
    // ═══════════════════════════════════════════════════════════════════════
    this.add.text(centerX, currentY, '═════════════════ COMBAT TEXT ═══════════════', {
      fontSize: scaledFontPx(fs, 14),
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    currentY += rowSpacing;

    // Damage Numbers Mode
    this.add.text(contentLeftX, currentY, 'Damage Numbers', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    const damageNumberModes: { mode: DamageNumbersMode; label: string }[] = [
      { mode: 'all', label: 'All' },
      { mode: 'crits', label: 'Crits' },
      { mode: 'perfect_crits', label: 'Perfect Crits' },
      { mode: 'off', label: 'Off' },
    ];

    const modeStartX = contentLeftX + scaledInt(ls, 180);
    damageNumberModes.forEach((item, index) => {
      const buttonX = modeStartX + index * scaledInt(ls, 100);
      const isActive = settingsManager.getDamageNumbersMode() === item.mode;

      const button = this.add.text(buttonX, currentY, `[${item.label}]`, {
        fontSize: scaledFontPx(fs, 14),
        color: isActive ? '#ffdd44' : '#888888',
        fontFamily: 'Arial',
      }).setInteractive({ useHandCursor: true });

      button.setData('zone', 'damageNumbers');
      button.setData('index', index);

      button.on('pointerover', () => {
        this.focusZone = 'damageNumbers';
        this.damageNumberIndex = index;
        this.updateFocusVisuals();
      });

      button.on('pointerdown', () => {
        settingsManager.setDamageNumbersMode(item.mode);
        this.damageNumberIndex = index;
        this.updateDamageNumberButtons();
      });

      addButtonInteraction(this, button);
      this.damageNumberButtons.push(button);
    });

    currentY += rowSpacing;

    // Status Text Toggle
    this.add.text(contentLeftX, currentY, 'Status Text', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.statusTextToggle = this.createToggle(contentLeftX + scaledInt(ls, 180), currentY, settingsManager.isStatusTextEnabled(), () => {
      const newValue = !settingsManager.isStatusTextEnabled();
      settingsManager.setStatusTextEnabled(newValue);
      this.updateStatusTextToggle();
    });
    this.statusTextToggle.setData('zone', 'statusText');

    // Status Text hint
    this.add.text(contentLeftX + scaledInt(ls, 280), currentY, '(DODGE, BLOCKED, etc.)', {
      fontSize: scaledFontPx(fs, 12),
      color: '#666666',
      fontFamily: 'Arial',
    });

    currentY += sectionSpacing;

    // ═══════════════════════════════════════════════════════════════════════
    // DATA Section
    // ═══════════════════════════════════════════════════════════════════════
    this.add.text(centerX, currentY, '══════════════════ DATA ═════════════════════', {
      fontSize: scaledFontPx(fs, 14),
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    currentY += rowSpacing;

    this.resetDataButton = this.add.text(centerX, currentY, '[ Reset All Data ]', {
      fontSize: scaledFontPx(fs, 16),
      color: '#ff4444',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.resetDataButton.setData('zone', 'resetData');
    this.resetDataButton.on('pointerover', () => {
      this.focusZone = 'resetData';
      this.updateFocusVisuals();
    });
    this.resetDataButton.on('pointerdown', () => {
      this.showResetConfirmation();
    });
    addButtonInteraction(this, this.resetDataButton);

    this.add.text(centerX, currentY + scaledInt(ls, 20), 'Erases all progress, upgrades, achievements, and settings', {
      fontSize: scaledFontPx(fs, 11),
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    currentY += sectionSpacing;

    // ═══════════════════════════════════════════════════════════════════════
    // Back Button
    // ═══════════════════════════════════════════════════════════════════════
    this.backButton = this.add.text(centerX, this.cameras.main.height - scaledInt(ls, 30), '[ Back ]', {
      fontSize: scaledFontPx(fs, 20),
      color: '#888888',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.backButton.setData('zone', 'back');
    this.backButton.on('pointerover', () => {
      this.focusZone = 'back';
      this.updateFocusVisuals();
    });
    this.backButton.on('pointerdown', () => {
      this.goBack();
    });
    addButtonInteraction(this, this.backButton);

    // Setup keyboard navigation
    this.setupKeyboardNavigation();

    // Setup gamepad navigation via MenuNavigator
    this.buildMenuNavigator();

    this.updateFocusVisuals();

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private updateUiScaleText(): void {
    const uiScale = getSettingsManager().getUiScale();
    this.uiScaleText.setText(`${Math.round(uiScale * 100)}%`);
  }

  private createToggle(x: number, y: number, initialValue: boolean, onChange: () => void): Phaser.GameObjects.Text {
    const text = initialValue ? '[ ON ]  OFF' : '  ON  [OFF]';
    const toggle = this.add.text(x, y, text, {
      fontSize: scaledFontPx(this.fontScale, 16),
      color: initialValue ? '#88ff88' : '#ff8888',
      fontFamily: 'Arial',
    }).setInteractive({ useHandCursor: true });

    toggle.on('pointerover', () => {
      const zone = toggle.getData('zone') as FocusZone;
      this.focusZone = zone;
      this.updateFocusVisuals();
    });

    toggle.on('pointerdown', () => {
      this.soundManager.playUIClick();
      onChange();
    });

    addButtonInteraction(this, toggle);
    return toggle;
  }

  private createButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const button = this.add.text(x, y, label, {
      fontSize: scaledFontPx(this.fontScale, 16),
      color: '#888888',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });

    button.on('pointerover', () => {
      const zone = button.getData('zone') as FocusZone;
      this.focusZone = zone;
      this.updateFocusVisuals();
    });

    button.on('pointerdown', () => {
      this.soundManager.playUIClick();
      onClick();
    });

    addButtonInteraction(this, button);
    return button;
  }

  private getDamageNumberModeIndex(mode: DamageNumbersMode): number {
    const modes: DamageNumbersMode[] = ['all', 'crits', 'perfect_crits', 'off'];
    return modes.indexOf(mode);
  }

  private getPlaybackModeIndex(mode: string): number {
    // Map modes to button index: sequential=0, shuffle=1, off defaults to sequential=0
    if (mode === 'shuffle') return 1;
    return 0; // sequential or off
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Update Methods
  // ═══════════════════════════════════════════════════════════════════════════

  private updateSfxToggle(): void {
    const enabled = getSettingsManager().isSfxEnabled();
    this.sfxToggle.setText(enabled ? '[ ON ]  OFF' : '  ON  [OFF]');
    this.sfxToggle.setColor(enabled ? '#88ff88' : '#ff8888');
  }

  private updateSfxVolume(): void {
    const volume = getSettingsManager().getSfxVolume();
    this.sfxVolumeText.setText(`${Math.round(volume * 100)}%`);
  }

  private updateBgmToggle(): void {
    const enabled = getMusicManager().getPlaybackMode() !== 'off';
    this.bgmToggle.setText(enabled ? '[ ON ]  OFF' : '  ON  [OFF]');
    this.bgmToggle.setColor(enabled ? '#88ff88' : '#ff8888');
  }

  private updateBgmVolume(): void {
    const volume = getMusicManager().getVolume();
    this.bgmVolumeText.setText(`${Math.round(volume * 100)}%`);
  }

  private updateScreenShakeToggle(): void {
    const enabled = getSettingsManager().isScreenShakeEnabled();
    this.screenShakeToggle.setText(enabled ? '[ ON ]  OFF' : '  ON  [OFF]');
    this.screenShakeToggle.setColor(enabled ? '#88ff88' : '#ff8888');
  }

  private updateReducedMotionToggle(): void {
    const enabled = getSettingsManager().isReducedMotionEnabled();
    this.reducedMotionToggle.setText(enabled ? '[ ON ]  OFF' : '  ON  [OFF]');
    this.reducedMotionToggle.setColor(enabled ? '#88ff88' : '#ff8888');
  }

  private updateGridEffectsToggle(): void {
    const enabled = getSettingsManager().isGridEffectsEnabled();
    this.gridEffectsToggle.setText(enabled ? '[ ON ]  OFF' : '  ON  [OFF]');
    this.gridEffectsToggle.setColor(enabled ? '#88ff88' : '#ff8888');
  }

  private updateFpsCounterToggle(): void {
    const enabled = getSettingsManager().isFpsCounterEnabled();
    this.fpsCounterToggle.setText(enabled ? '[ ON ]  OFF' : '  ON  [OFF]');
    this.fpsCounterToggle.setColor(enabled ? '#88ff88' : '#ff8888');
  }

  private updateDamageNumberButtons(): void {
    const currentMode = getSettingsManager().getDamageNumbersMode();
    const modes: DamageNumbersMode[] = ['all', 'crits', 'perfect_crits', 'off'];

    this.damageNumberButtons.forEach((button, index) => {
      const isActive = modes[index] === currentMode;
      const isFocused = this.focusZone === 'damageNumbers' && this.damageNumberIndex === index;
      button.setColor(isFocused ? '#ffffff' : isActive ? '#ffdd44' : '#888888');
    });
  }

  private updatePlaybackModeButtons(): void {
    const currentMode = getMusicManager().getPlaybackMode();
    const modes: ('sequential' | 'shuffle')[] = ['sequential', 'shuffle'];

    this.playbackModeButtons.forEach((button, index) => {
      const isActive = modes[index] === currentMode || (currentMode === 'off' && modes[index] === 'sequential');
      const isFocused = this.focusZone === 'playbackMode' && this.playbackModeIndex === index;
      button.setColor(isFocused ? '#ffffff' : isActive ? '#ffdd44' : '#888888');
    });
  }

  private updateStatusTextToggle(): void {
    const enabled = getSettingsManager().isStatusTextEnabled();
    this.statusTextToggle.setText(enabled ? '[ ON ]  OFF' : '  ON  [OFF]');
    this.statusTextToggle.setColor(enabled ? '#88ff88' : '#ff8888');
  }

  private updateFocusVisuals(): void {
    // Reset all elements to their default state
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();

    // SFX Toggle
    const sfxEnabled = settingsManager.isSfxEnabled();
    this.sfxToggle.setColor(this.focusZone === 'sfx' ? '#ffffff' : sfxEnabled ? '#88ff88' : '#ff8888');

    // SFX Volume
    const sfxVolumeFocused = this.focusZone === 'sfxVolume';
    this.sfxVolumeDown.setColor(sfxVolumeFocused ? '#ffffff' : '#888888');
    this.sfxVolumeUp.setColor(sfxVolumeFocused ? '#ffffff' : '#888888');

    // BGM Toggle
    const bgmEnabled = musicManager.getPlaybackMode() !== 'off';
    this.bgmToggle.setColor(this.focusZone === 'bgm' ? '#ffffff' : bgmEnabled ? '#88ff88' : '#ff8888');

    // BGM Volume
    const bgmVolumeFocused = this.focusZone === 'bgmVolume';
    this.bgmVolumeDown.setColor(bgmVolumeFocused ? '#ffffff' : '#888888');
    this.bgmVolumeUp.setColor(bgmVolumeFocused ? '#ffffff' : '#888888');

    // Playback Mode buttons
    this.updatePlaybackModeButtons();

    // Music Tracks button
    this.musicTracksButton.setColor(this.focusZone === 'musicTracks' ? '#ffffff' : '#888888');

    // Screen Shake
    const shakeEnabled = settingsManager.isScreenShakeEnabled();
    this.screenShakeToggle.setColor(this.focusZone === 'screenShake' ? '#ffffff' : shakeEnabled ? '#88ff88' : '#ff8888');

    // Reduced Motion
    const reducedMotionEnabled = settingsManager.isReducedMotionEnabled();
    this.reducedMotionToggle.setColor(this.focusZone === 'reducedMotion' ? '#ffffff' : reducedMotionEnabled ? '#88ff88' : '#ff8888');

    // Grid Effects
    const gridEnabled = settingsManager.isGridEffectsEnabled();
    this.gridEffectsToggle.setColor(this.focusZone === 'gridEffects' ? '#ffffff' : gridEnabled ? '#88ff88' : '#ff8888');

    // FPS Counter
    const fpsEnabled = settingsManager.isFpsCounterEnabled();
    this.fpsCounterToggle.setColor(this.focusZone === 'fpsCounter' ? '#ffffff' : fpsEnabled ? '#88ff88' : '#ff8888');

    // UI Scale
    const uiScaleFocused = this.focusZone === 'uiScale';
    this.uiScaleDown.setColor(uiScaleFocused ? '#ffffff' : '#888888');
    this.uiScaleUp.setColor(uiScaleFocused ? '#ffffff' : '#888888');

    // Damage Numbers
    this.updateDamageNumberButtons();

    // Status Text
    const statusEnabled = settingsManager.isStatusTextEnabled();
    this.statusTextToggle.setColor(this.focusZone === 'statusText' ? '#ffffff' : statusEnabled ? '#88ff88' : '#ff8888');

    // Reset Data button
    this.resetDataButton.setColor(this.focusZone === 'resetData' ? '#ff6666' : '#ff4444');

    // Back button
    this.backButton.setColor(this.focusZone === 'back' ? '#ffdd44' : '#888888');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gamepad Navigation (MenuNavigator)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds a MenuNavigator that maps each settings focus zone to a navigable item,
   * providing gamepad D-pad/stick/A/B support alongside the existing keyboard handler.
   */
  private buildMenuNavigator(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
    }

    // Ordered list of focus zones matching the vertical layout
    const orderedZones: FocusZone[] = [
      'sfx', 'sfxVolume', 'bgm', 'bgmVolume', 'playbackMode', 'musicTracks',
      'screenShake', 'reducedMotion', 'gridEffects', 'fpsCounter', 'uiScale',
      'damageNumbers', 'statusText', 'resetData', 'back',
    ];

    const navigableItems = orderedZones.map((zone) => ({
      onFocus: () => {
        this.focusZone = zone;
        this.updateFocusVisuals();
      },
      onBlur: () => {
        this.updateFocusVisuals();
      },
      onActivate: () => {
        this.activateCurrentSelection();
      },
    }));

    const currentZoneIndex = orderedZones.indexOf(this.focusZone);

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: 1,
      wrap: true,
      onCancel: () => {
        this.goBack();
      },
      initialIndex: currentZoneIndex >= 0 ? currentZoneIndex : 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard Navigation
  // ═══════════════════════════════════════════════════════════════════════════

  private setupKeyboardNavigation(): void {
    // This handler covers two things MenuNavigator doesn't:
    // 1. Confirmation dialog keyboard navigation (when overlay is open)
    // 2. Left/right value adjustment for settings zones (volume, damage numbers, etc.)
    // Up/down/enter/escape for normal navigation are handled by MenuNavigator.
    this.keydownHandler = (event: KeyboardEvent) => {
      // When confirmation dialog is open, handle its own navigation
      if (this.confirmOverlay.length > 0) {
        switch (event.key) {
          case 'ArrowLeft':
          case 'a':
          case 'A':
          case 'ArrowRight':
          case 'd':
          case 'D':
          case 'ArrowUp':
          case 'w':
          case 'W':
          case 'ArrowDown':
          case 's':
          case 'S':
            event.preventDefault();
            this.confirmFocusIndex = this.confirmFocusIndex === 0 ? 1 : 0;
            this.updateConfirmFocusVisuals();
            break;
          case 'Enter':
          case ' ':
            event.preventDefault();
            this.activateConfirmSelection();
            break;
          case 'Escape':
            event.preventDefault();
            this.dismissResetConfirmation();
            break;
        }
        return;
      }

      // Left/right for value adjustment (not handled by MenuNavigator with columns=1)
      switch (event.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          event.preventDefault();
          this.navigateLeft();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          event.preventDefault();
          this.navigateRight();
          break;
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);
  }

  private navigateLeft(): void {
    if (this.focusZone === 'sfxVolume') {
      this.focusZone = 'sfx';
    } else if (this.focusZone === 'bgmVolume') {
      this.focusZone = 'bgm';
    } else if (this.focusZone === 'playbackMode') {
      this.playbackModeIndex = Math.max(0, this.playbackModeIndex - 1);
    } else if (this.focusZone === 'uiScale') {
      getSettingsManager().setUiScale(getSettingsManager().getUiScale() - 0.1);
      this.updateUiScaleText();
    } else if (this.focusZone === 'damageNumbers') {
      this.damageNumberIndex = Math.max(0, this.damageNumberIndex - 1);
    }
    this.updateFocusVisuals();
  }

  private navigateRight(): void {
    if (this.focusZone === 'sfx') {
      this.focusZone = 'sfxVolume';
    } else if (this.focusZone === 'bgm') {
      this.focusZone = 'bgmVolume';
    } else if (this.focusZone === 'playbackMode') {
      this.playbackModeIndex = Math.min(1, this.playbackModeIndex + 1);
    } else if (this.focusZone === 'uiScale') {
      getSettingsManager().setUiScale(getSettingsManager().getUiScale() + 0.1);
      this.updateUiScaleText();
    } else if (this.focusZone === 'damageNumbers') {
      this.damageNumberIndex = Math.min(3, this.damageNumberIndex + 1);
    }
    this.updateFocusVisuals();
  }

  private activateCurrentSelection(): void {
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();

    switch (this.focusZone) {
      case 'sfx':
        settingsManager.setSfxEnabled(!settingsManager.isSfxEnabled());
        this.updateSfxToggle();
        break;
      case 'sfxVolume':
        // Volume adjustment via left/right arrows
        break;
      case 'bgm':
        if (musicManager.getPlaybackMode() === 'off') {
          musicManager.setPlaybackMode('sequential');
          musicManager.play();
        } else {
          musicManager.setPlaybackMode('off');
          musicManager.stop();
        }
        this.updateBgmToggle();
        break;
      case 'bgmVolume':
        // Volume adjustment via left/right arrows
        break;
      case 'playbackMode': {
        const playbackModes: ('sequential' | 'shuffle')[] = ['sequential', 'shuffle'];
        const wasOff = musicManager.getPlaybackMode() === 'off';
        musicManager.setPlaybackMode(playbackModes[this.playbackModeIndex]);
        this.updatePlaybackModeButtons();
        // If music was off, also start playing
        if (wasOff) {
          musicManager.play();
          this.updateBgmToggle();
        }
        break;
      }
      case 'musicTracks':
        this.scene.start('MusicSettingsScene', { returnTo: 'SettingsScene', originalReturnTo: this.returnTo });
        break;
      case 'screenShake':
        settingsManager.setScreenShakeEnabled(!settingsManager.isScreenShakeEnabled());
        this.updateScreenShakeToggle();
        break;
      case 'reducedMotion':
        settingsManager.setReducedMotion(!settingsManager.isReducedMotionEnabled());
        this.updateReducedMotionToggle();
        break;
      case 'gridEffects':
        settingsManager.setGridEffectsEnabled(!settingsManager.isGridEffectsEnabled());
        this.updateGridEffectsToggle();
        break;
      case 'fpsCounter':
        settingsManager.setFpsCounterEnabled(!settingsManager.isFpsCounterEnabled());
        this.updateFpsCounterToggle();
        break;
      case 'uiScale':
        // Adjustment via left/right arrows
        break;
      case 'damageNumbers': {
        const modes: DamageNumbersMode[] = ['all', 'crits', 'perfect_crits', 'off'];
        settingsManager.setDamageNumbersMode(modes[this.damageNumberIndex]);
        this.updateDamageNumberButtons();
        break;
      }
      case 'statusText':
        settingsManager.setStatusTextEnabled(!settingsManager.isStatusTextEnabled());
        this.updateStatusTextToggle();
        break;
      case 'resetData':
        this.showResetConfirmation();
        break;
      case 'back':
        this.goBack();
        break;
    }
  }

  private showResetConfirmation(): void {
    // Prevent opening multiple overlays
    if (this.confirmOverlay.length > 0) return;

    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    const ls = this.layoutScale;
    const fs = this.fontScale;

    // Dim background
    const dimBg = this.add.rectangle(centerX, centerY, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.7)
      .setInteractive() // Block clicks to elements behind
      .setDepth(100);

    // Dialog box
    const dialogBg = this.add.rectangle(centerX, centerY, scaledInt(ls, 420), scaledInt(ls, 200), 0x111111, 1)
      .setStrokeStyle(2, 0xff4444)
      .setDepth(101);

    const titleText = this.add.text(centerX, centerY - scaledInt(ls, 60), 'RESET ALL DATA?', {
      fontSize: scaledFontPx(fs, 22),
      color: '#ff4444',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(102);

    const descText = this.add.text(centerX, centerY - scaledInt(ls, 20), 'This will permanently erase all progress,\nupgrades, achievements, and settings.\nThis cannot be undone.', {
      fontSize: scaledFontPx(fs, 14),
      color: '#cccccc',
      fontFamily: 'Arial',
      align: 'center',
    }).setOrigin(0.5).setDepth(102);

    const confirmButton = this.add.text(centerX - scaledInt(ls, 80), centerY + scaledInt(ls, 50), '[ Confirm ]', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ff4444',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(102);

    confirmButton.on('pointerover', () => { this.confirmFocusIndex = 0; this.updateConfirmFocusVisuals(); });
    confirmButton.on('pointerout', () => confirmButton.setColor('#ff4444'));
    confirmButton.on('pointerdown', () => {
      for (const key of ALL_STORAGE_KEYS) {
        SecureStorage.removeItem(key);
      }
      localStorage.clear();
      window.location.reload();
    });
    addButtonInteraction(this, confirmButton);

    const cancelButton = this.add.text(centerX + scaledInt(ls, 80), centerY + scaledInt(ls, 50), '[ Cancel ]', {
      fontSize: scaledFontPx(fs, 18),
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(102);

    cancelButton.on('pointerover', () => { this.confirmFocusIndex = 1; this.updateConfirmFocusVisuals(); });
    cancelButton.on('pointerout', () => this.updateConfirmFocusVisuals());
    cancelButton.on('pointerdown', () => {
      this.dismissResetConfirmation();
    });
    addButtonInteraction(this, cancelButton);

    this.confirmButtonRef = confirmButton;
    this.cancelButtonRef = cancelButton;
    this.confirmFocusIndex = 1; // Default to Cancel for safety
    this.updateConfirmFocusVisuals();

    this.confirmOverlay = [dimBg, dialogBg, titleText, descText, confirmButton, cancelButton];
  }

  private updateConfirmFocusVisuals(): void {
    if (this.confirmButtonRef) {
      this.confirmButtonRef.setColor(this.confirmFocusIndex === 0 ? '#ff6666' : '#ff4444');
    }
    if (this.cancelButtonRef) {
      this.cancelButtonRef.setColor(this.confirmFocusIndex === 1 ? '#ffffff' : '#888888');
    }
  }

  private activateConfirmSelection(): void {
    if (this.confirmFocusIndex === 0) {
      for (const key of ALL_STORAGE_KEYS) {
        SecureStorage.removeItem(key);
      }
      localStorage.clear();
      window.location.reload();
    } else {
      this.dismissResetConfirmation();
    }
  }

  private dismissResetConfirmation(): void {
    for (const obj of this.confirmOverlay) {
      obj.destroy();
    }
    this.confirmOverlay = [];
    this.confirmButtonRef = null;
    this.cancelButtonRef = null;
  }

  private goBack(): void {
    if (this.returnTo === 'GameScene') {
      // Directly tell GameScene to show pause menu before resuming
      // (more reliable than relying on the 'resume' event)
      const gameScene = this.scene.get('GameScene') as GameScene;
      if (gameScene?.showPauseMenuFromSettings) {
        gameScene.showPauseMenuFromSettings();
      }
      this.scene.resume('GameScene');
      this.scene.stop();
    } else {
      this.scene.start('BootScene');
    }
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.tweens.killAll();
  }
}
