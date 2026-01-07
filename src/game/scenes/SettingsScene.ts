/**
 * SettingsScene - Unified settings UI accessible from both BootScene and GameScene pause menu.
 * Uses an overlay approach so it doesn't interrupt gameplay when accessed during a run.
 */

import Phaser from 'phaser';
import { getSettingsManager, DamageNumbersMode } from '../../settings';
import { getMusicManager } from '../../audio/MusicManager';
import type { GameScene } from './GameScene';

type FocusZone = 'sfx' | 'sfxVolume' | 'bgm' | 'bgmVolume' | 'playbackMode' | 'musicTracks' | 'screenShake' | 'fpsCounter' | 'damageNumbers' | 'statusText' | 'back';

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
  private fpsCounterToggle!: Phaser.GameObjects.Text;
  private damageNumberButtons: Phaser.GameObjects.Text[] = [];
  private statusTextToggle!: Phaser.GameObjects.Text;
  private backButton!: Phaser.GameObjects.Text;

  // Navigation state
  private focusZone: FocusZone = 'sfx';
  private damageNumberIndex: number = 0;
  private playbackModeIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor() {
    super({ key: 'SettingsScene' });
  }

  init(data: SettingsSceneData): void {
    this.returnTo = data?.returnTo || 'BootScene';
  }

  create(): void {
    const centerX = this.cameras.main.centerX;
    const settingsManager = getSettingsManager();
    const musicManager = getMusicManager();

    // Reset state
    this.damageNumberButtons = [];
    this.playbackModeButtons = [];
    this.focusZone = 'sfx';
    this.damageNumberIndex = this.getDamageNumberModeIndex(settingsManager.getDamageNumbersMode());
    this.playbackModeIndex = this.getPlaybackModeIndex(musicManager.getPlaybackMode());

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
    this.add.text(centerX, 40, 'SETTINGS', {
      fontSize: '36px',
      color: '#ffdd44',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    let currentY = 90;

    // ═══════════════════════════════════════════════════════════════════════
    // AUDIO Section
    // ═══════════════════════════════════════════════════════════════════════
    this.add.text(centerX, currentY, '═══════════════════ AUDIO ═══════════════════', {
      fontSize: '14px',
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    currentY += 35;

    // SFX Toggle + Volume
    this.add.text(100, currentY, 'SFX', {
      fontSize: '18px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.sfxToggle = this.createToggle(200, currentY, settingsManager.isSfxEnabled(), () => {
      const newValue = !settingsManager.isSfxEnabled();
      settingsManager.setSfxEnabled(newValue);
      this.updateSfxToggle();
    });
    this.sfxToggle.setData('zone', 'sfx');

    this.add.text(350, currentY, 'Volume', {
      fontSize: '16px',
      color: '#aaaaaa',
      fontFamily: 'Arial',
    });

    this.sfxVolumeDown = this.createButton(440, currentY, '[ - ]', () => {
      settingsManager.setSfxVolume(settingsManager.getSfxVolume() - 0.1);
      this.updateSfxVolume();
    });
    this.sfxVolumeDown.setData('zone', 'sfxVolume');

    this.sfxVolumeText = this.add.text(500, currentY, `${Math.round(settingsManager.getSfxVolume() * 100)}%`, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0);

    this.sfxVolumeUp = this.createButton(560, currentY, '[ + ]', () => {
      settingsManager.setSfxVolume(settingsManager.getSfxVolume() + 0.1);
      this.updateSfxVolume();
    });
    this.sfxVolumeUp.setData('zone', 'sfxVolume');

    currentY += 35;

    // BGM Toggle + Volume
    this.add.text(100, currentY, 'BGM', {
      fontSize: '18px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    const bgmEnabled = musicManager.getPlaybackMode() !== 'off';
    this.bgmToggle = this.createToggle(200, currentY, bgmEnabled, () => {
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

    this.add.text(350, currentY, 'Volume', {
      fontSize: '16px',
      color: '#aaaaaa',
      fontFamily: 'Arial',
    });

    this.bgmVolumeDown = this.createButton(440, currentY, '[ - ]', () => {
      musicManager.setVolume(musicManager.getVolume() - 0.1);
      this.updateBgmVolume();
    });
    this.bgmVolumeDown.setData('zone', 'bgmVolume');

    this.bgmVolumeText = this.add.text(500, currentY, `${Math.round(musicManager.getVolume() * 100)}%`, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0);

    this.bgmVolumeUp = this.createButton(560, currentY, '[ + ]', () => {
      musicManager.setVolume(musicManager.getVolume() + 0.1);
      this.updateBgmVolume();
    });
    this.bgmVolumeUp.setData('zone', 'bgmVolume');

    currentY += 35;

    // Playback Mode selector (Sequential / Shuffle)
    this.add.text(100, currentY, 'Playback', {
      fontSize: '18px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    const playbackModes: { mode: 'sequential' | 'shuffle' | 'off'; label: string }[] = [
      { mode: 'sequential', label: 'Sequential' },
      { mode: 'shuffle', label: 'Shuffle' },
    ];

    const playbackModeStartX = 220;
    playbackModes.forEach((item, index) => {
      const buttonX = playbackModeStartX + index * 100;
      const currentMode = musicManager.getPlaybackMode();
      const isActive = currentMode === item.mode || (currentMode === 'off' && item.mode === 'sequential');

      const button = this.add.text(buttonX, currentY, `[${item.label}]`, {
        fontSize: '14px',
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

      this.playbackModeButtons.push(button);
    });

    currentY += 40;

    // Music Track Selection button
    this.musicTracksButton = this.add.text(centerX, currentY, '[ Music Track Selection ]', {
      fontSize: '16px',
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

    currentY += 50;

    // ═══════════════════════════════════════════════════════════════════════
    // VISUALS Section
    // ═══════════════════════════════════════════════════════════════════════
    this.add.text(centerX, currentY, '═══════════════════ VISUALS ═════════════════', {
      fontSize: '14px',
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    currentY += 35;

    // Screen Shake Toggle
    this.add.text(100, currentY, 'Screen Shake', {
      fontSize: '18px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.screenShakeToggle = this.createToggle(280, currentY, settingsManager.isScreenShakeEnabled(), () => {
      const newValue = !settingsManager.isScreenShakeEnabled();
      settingsManager.setScreenShakeEnabled(newValue);
      this.updateScreenShakeToggle();
    });
    this.screenShakeToggle.setData('zone', 'screenShake');

    currentY += 35;

    // FPS Counter Toggle
    this.add.text(100, currentY, 'FPS Counter', {
      fontSize: '18px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.fpsCounterToggle = this.createToggle(280, currentY, settingsManager.isFpsCounterEnabled(), () => {
      const newValue = !settingsManager.isFpsCounterEnabled();
      settingsManager.setFpsCounterEnabled(newValue);
      this.updateFpsCounterToggle();
    });
    this.fpsCounterToggle.setData('zone', 'fpsCounter');

    currentY += 50;

    // ═══════════════════════════════════════════════════════════════════════
    // COMBAT TEXT Section
    // ═══════════════════════════════════════════════════════════════════════
    this.add.text(centerX, currentY, '═════════════════ COMBAT TEXT ═══════════════', {
      fontSize: '14px',
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    currentY += 35;

    // Damage Numbers Mode
    this.add.text(100, currentY, 'Damage Numbers', {
      fontSize: '18px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    const damageNumberModes: { mode: DamageNumbersMode; label: string }[] = [
      { mode: 'all', label: 'All' },
      { mode: 'crits', label: 'Critical Hits' },
      { mode: 'perfect_crits', label: 'Perfect Critical Hits' },
      { mode: 'off', label: 'Off' },
    ];

    const modeStartX = 280;
    damageNumberModes.forEach((item, index) => {
      const buttonX = modeStartX + index * 80;
      const isActive = settingsManager.getDamageNumbersMode() === item.mode;

      const button = this.add.text(buttonX, currentY, `[${item.label}]`, {
        fontSize: '14px',
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

      this.damageNumberButtons.push(button);
    });

    currentY += 35;

    // Status Text Toggle
    this.add.text(100, currentY, 'Status Text', {
      fontSize: '18px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });

    this.statusTextToggle = this.createToggle(280, currentY, settingsManager.isStatusTextEnabled(), () => {
      const newValue = !settingsManager.isStatusTextEnabled();
      settingsManager.setStatusTextEnabled(newValue);
      this.updateStatusTextToggle();
    });
    this.statusTextToggle.setData('zone', 'statusText');

    // Status Text hint
    this.add.text(380, currentY, '(DODGE, BLOCKED, etc.)', {
      fontSize: '12px',
      color: '#666666',
      fontFamily: 'Arial',
    });

    currentY += 60;

    // ═══════════════════════════════════════════════════════════════════════
    // Back Button
    // ═══════════════════════════════════════════════════════════════════════
    this.backButton = this.add.text(centerX, this.cameras.main.height - 50, '[ Back ]', {
      fontSize: '20px',
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

    // Setup keyboard navigation
    this.setupKeyboardNavigation();
    this.updateFocusVisuals();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private createToggle(x: number, y: number, initialValue: boolean, onChange: () => void): Phaser.GameObjects.Text {
    const text = initialValue ? '[ ON ]  OFF' : '  ON  [OFF]';
    const toggle = this.add.text(x, y, text, {
      fontSize: '16px',
      color: initialValue ? '#88ff88' : '#ff8888',
      fontFamily: 'Arial',
    }).setInteractive({ useHandCursor: true });

    toggle.on('pointerover', () => {
      const zone = toggle.getData('zone') as FocusZone;
      this.focusZone = zone;
      this.updateFocusVisuals();
    });

    toggle.on('pointerdown', onChange);

    return toggle;
  }

  private createButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const button = this.add.text(x, y, label, {
      fontSize: '16px',
      color: '#888888',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });

    button.on('pointerover', () => {
      const zone = button.getData('zone') as FocusZone;
      this.focusZone = zone;
      this.updateFocusVisuals();
    });

    button.on('pointerdown', onClick);

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

    // FPS Counter
    const fpsEnabled = settingsManager.isFpsCounterEnabled();
    this.fpsCounterToggle.setColor(this.focusZone === 'fpsCounter' ? '#ffffff' : fpsEnabled ? '#88ff88' : '#ff8888');

    // Damage Numbers
    this.updateDamageNumberButtons();

    // Status Text
    const statusEnabled = settingsManager.isStatusTextEnabled();
    this.statusTextToggle.setColor(this.focusZone === 'statusText' ? '#ffffff' : statusEnabled ? '#88ff88' : '#ff8888');

    // Back button
    this.backButton.setColor(this.focusZone === 'back' ? '#ffdd44' : '#888888');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard Navigation
  // ═══════════════════════════════════════════════════════════════════════════

  private setupKeyboardNavigation(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
        case 's':
        case 'S':
          event.preventDefault();
          this.navigateDown();
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
          event.preventDefault();
          this.navigateUp();
          break;
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
        case 'Enter':
        case ' ':
          event.preventDefault();
          this.activateCurrentSelection();
          break;
        case 'Escape':
          event.preventDefault();
          this.goBack();
          break;
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);
  }

  private navigateDown(): void {
    // Navigate to next row
    if (this.focusZone === 'sfx' || this.focusZone === 'sfxVolume') {
      this.focusZone = 'bgm';
    } else if (this.focusZone === 'bgm' || this.focusZone === 'bgmVolume') {
      this.focusZone = 'playbackMode';
    } else if (this.focusZone === 'playbackMode') {
      this.focusZone = 'musicTracks';
    } else if (this.focusZone === 'musicTracks') {
      this.focusZone = 'screenShake';
    } else if (this.focusZone === 'screenShake') {
      this.focusZone = 'fpsCounter';
    } else if (this.focusZone === 'fpsCounter') {
      this.focusZone = 'damageNumbers';
    } else if (this.focusZone === 'damageNumbers') {
      this.focusZone = 'statusText';
    } else if (this.focusZone === 'statusText') {
      this.focusZone = 'back';
    } else if (this.focusZone === 'back') {
      this.focusZone = 'sfx';
    }

    this.updateFocusVisuals();
  }

  private navigateUp(): void {
    if (this.focusZone === 'sfx' || this.focusZone === 'sfxVolume') {
      this.focusZone = 'back';
    } else if (this.focusZone === 'bgm' || this.focusZone === 'bgmVolume') {
      this.focusZone = 'sfx';
    } else if (this.focusZone === 'playbackMode') {
      this.focusZone = 'bgm';
    } else if (this.focusZone === 'musicTracks') {
      this.focusZone = 'playbackMode';
    } else if (this.focusZone === 'screenShake') {
      this.focusZone = 'musicTracks';
    } else if (this.focusZone === 'fpsCounter') {
      this.focusZone = 'screenShake';
    } else if (this.focusZone === 'damageNumbers') {
      this.focusZone = 'fpsCounter';
    } else if (this.focusZone === 'statusText') {
      this.focusZone = 'damageNumbers';
    } else if (this.focusZone === 'back') {
      this.focusZone = 'statusText';
    }

    this.updateFocusVisuals();
  }

  private navigateLeft(): void {
    if (this.focusZone === 'sfxVolume') {
      this.focusZone = 'sfx';
    } else if (this.focusZone === 'bgmVolume') {
      this.focusZone = 'bgm';
    } else if (this.focusZone === 'playbackMode') {
      this.playbackModeIndex = Math.max(0, this.playbackModeIndex - 1);
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
      case 'fpsCounter':
        settingsManager.setFpsCounterEnabled(!settingsManager.isFpsCounterEnabled());
        this.updateFpsCounterToggle();
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
      case 'back':
        this.goBack();
        break;
    }
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
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
}
