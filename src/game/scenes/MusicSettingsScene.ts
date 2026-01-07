/**
 * MusicSettingsScene - UI for selecting music tracks.
 * Allows enabling/disabling individual tracks in the playlist.
 * Full keyboard navigation support with zone-based focus system.
 */

import Phaser from 'phaser';
import { getMusicManager } from '../../audio/MusicManager';
import { MUSIC_CATALOG, Track } from '../../data/MusicCatalog';

type FocusZone = 'actions' | 'tracks' | 'back';

interface MusicSettingsSceneData {
  returnTo?: 'BootScene' | 'SettingsScene';
  originalReturnTo?: 'BootScene' | 'GameScene';
}

export class MusicSettingsScene extends Phaser.Scene {
  private returnTo: 'BootScene' | 'SettingsScene' = 'BootScene';
  private originalReturnTo: 'BootScene' | 'GameScene' = 'BootScene';
  private trackCheckboxes: Map<string, { checkbox: Phaser.GameObjects.Text; label: Phaser.GameObjects.Text; selector: Phaser.GameObjects.Text; playingIndicator: Phaser.GameObjects.Text }> = new Map();
  private actionButtons: Phaser.GameObjects.Text[] = [];
  private backButton!: Phaser.GameObjects.Text;
  private nowPlayingText!: Phaser.GameObjects.Text;
  private scrollY: number = 0;
  private trackContainer!: Phaser.GameObjects.Container;
  private maxScrollY: number = 0;

  // Keyboard navigation state
  private focusZone: FocusZone = 'actions';
  private selectedActionIndex: number = 0;
  private selectedTrackIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  // Track list constants - positioned higher since we removed mode/volume
  private readonly trackListY = 140;
  private readonly trackHeight = 28;
  private readonly visibleHeight = 420;

  constructor() {
    super({ key: 'MusicSettingsScene' });
  }

  init(data: MusicSettingsSceneData): void {
    this.returnTo = data?.returnTo || 'BootScene';
    this.originalReturnTo = data?.originalReturnTo || 'BootScene';
  }

  create(): void {
    const centerX = this.cameras.main.centerX;
    const musicManager = getMusicManager();

    // Reset state
    this.actionButtons = [];
    this.trackCheckboxes.clear();
    this.focusZone = 'actions';
    this.selectedActionIndex = 0;
    this.selectedTrackIndex = 0;
    this.scrollY = 0;

    // Start music if not already playing (user has already interacted to get here)
    if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
      musicManager.play();
    }

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
    this.add
      .text(centerX, 40, 'MUSIC TRACKS', {
        fontSize: '36px',
        color: '#ffdd44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Now Playing indicator
    this.nowPlayingText = this.add
      .text(centerX, 80, '', {
        fontSize: '16px',
        color: '#88ff88',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);
    this.updateNowPlaying();

    // Select All / Deselect All buttons
    const selectAllButton = this.add
      .text(centerX - 80, 110, '[ Select All ]', {
        fontSize: '14px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    selectAllButton.on('pointerover', () => {
      this.selectedActionIndex = 0;
      this.focusZone = 'actions';
      this.updateFocusVisuals();
    });
    selectAllButton.on('pointerdown', () => {
      this.activateActionButton(0);
    });

    const deselectAllButton = this.add
      .text(centerX + 80, 110, '[ Deselect All ]', {
        fontSize: '14px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    deselectAllButton.on('pointerover', () => {
      this.selectedActionIndex = 1;
      this.focusZone = 'actions';
      this.updateFocusVisuals();
    });
    deselectAllButton.on('pointerdown', () => {
      this.activateActionButton(1);
    });

    this.actionButtons = [selectAllButton, deselectAllButton];

    // Create scrollable track list
    // Mask for scrollable area
    const maskGraphics = this.make.graphics({});
    maskGraphics.fillRect(20, this.trackListY, this.cameras.main.width - 40, this.visibleHeight);
    const mask = maskGraphics.createGeometryMask();

    // Container for tracks
    this.trackContainer = this.add.container(0, this.trackListY);
    this.trackContainer.setMask(mask);

    // Add tracks to container
    MUSIC_CATALOG.forEach((track, index) => {
      const trackY = index * this.trackHeight;
      this.createTrackRow(track, trackY, centerX, this.trackHeight, index);
    });

    // Calculate max scroll
    const totalHeight = MUSIC_CATALOG.length * this.trackHeight;
    this.maxScrollY = Math.max(0, totalHeight - this.visibleHeight);

    // Scroll instructions and P key hint
    const hintY = this.trackListY + this.visibleHeight + 10;
    if (this.maxScrollY > 0) {
      this.add
        .text(centerX, hintY, '[ Scroll with mouse wheel or arrow keys ]', {
          fontSize: '12px',
          color: '#555555',
          fontFamily: 'Arial',
        })
        .setOrigin(0.5);
    }

    // P key hint
    this.add
      .text(centerX, hintY + (this.maxScrollY > 0 ? 18 : 0), '[ Press P to play selected track ]', {
        fontSize: '12px',
        color: '#555555',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);

    // Mouse wheel scrolling
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY * 0.5, 0, this.maxScrollY);
      this.trackContainer.setY(this.trackListY - this.scrollY);
    });

    // Back button
    this.backButton = this.add
      .text(centerX, this.cameras.main.height - 40, '[ Back ]', {
        fontSize: '20px',
        color: '#888888',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.backButton.on('pointerover', () => {
      this.focusZone = 'back';
      this.updateFocusVisuals();
    });
    this.backButton.on('pointerout', () => this.updateFocusVisuals());
    this.backButton.on('pointerdown', () => {
      this.goBack();
    });

    // Update interval for now playing
    this.time.addEvent({
      delay: 1000,
      callback: this.updateNowPlaying,
      callbackScope: this,
      loop: true,
    });

    // Setup keyboard navigation
    this.setupKeyboardNavigation();

    // Initial focus visuals
    this.updateFocusVisuals();
  }

  /**
   * Creates a row for a track in the list.
   */
  private createTrackRow(track: Track, y: number, centerX: number, rowHeight: number, index: number): void {
    const musicManager = getMusicManager();
    const isEnabled = musicManager.isTrackEnabled(track.id);
    const currentTrack = musicManager.getCurrentTrack();
    const isPlaying = currentTrack?.id === track.id && musicManager.getIsPlaying();

    // Selection indicator (>) - shows when track is focused
    const selector = this.add
      .text(40, y, '', {
        fontSize: '14px',
        color: '#ffdd44',
        fontFamily: 'monospace',
      })
      .setOrigin(0, 0);

    // Checkbox
    const checkbox = this.add
      .text(60, y, isEnabled ? '[x]' : '[ ]', {
        fontSize: '14px',
        color: isEnabled ? '#88ff88' : '#666666',
        fontFamily: 'monospace',
      })
      .setOrigin(0, 0);

    // Track title
    const label = this.add
      .text(100, y, track.title, {
        fontSize: '14px',
        color: isPlaying ? '#ffdd44' : isEnabled ? '#ffffff' : '#666666',
        fontFamily: 'Arial',
      })
      .setOrigin(0, 0);

    // Playing indicator
    const playingIndicator = this.add
      .text(this.cameras.main.width - 80, y, isPlaying ? 'PLAYING' : '', {
        fontSize: '12px',
        color: '#ffdd44',
        fontFamily: 'Arial',
      })
      .setOrigin(0, 0);

    // Make row interactive
    const hitArea = this.add
      .rectangle(centerX, y + 10, this.cameras.main.width - 60, rowHeight - 4, 0x000000, 0)
      .setInteractive({ useHandCursor: true });

    hitArea.on('pointerover', () => {
      this.selectedTrackIndex = index;
      this.focusZone = 'tracks';
      this.updateFocusVisuals();
    });

    hitArea.on('pointerdown', () => {
      this.toggleTrack(index);
    });

    // Add to container
    this.trackContainer.add([selector, checkbox, label, playingIndicator, hitArea]);

    // Store references for updates
    this.trackCheckboxes.set(track.id, { checkbox, label, selector, playingIndicator });
  }

  /**
   * Sets up keyboard navigation handlers.
   */
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
        case 'p':
        case 'P':
          event.preventDefault();
          this.playFocusedTrack();
          break;
        case 'Escape':
          event.preventDefault();
          this.goBack();
          break;
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);
  }

  /**
   * Navigate down through zones or within tracks.
   */
  private navigateDown(): void {
    if (this.focusZone === 'tracks') {
      // Navigate within track list
      if (this.selectedTrackIndex < MUSIC_CATALOG.length - 1) {
        this.selectedTrackIndex++;
        this.ensureTrackVisible();
      } else {
        // Move to back button
        this.focusZone = 'back';
      }
    } else if (this.focusZone === 'actions') {
      // Move to tracks
      this.focusZone = 'tracks';
      this.selectedTrackIndex = 0;
      this.ensureTrackVisible();
    } else if (this.focusZone === 'back') {
      // Wrap to actions
      this.focusZone = 'actions';
    }
    this.updateFocusVisuals();
  }

  /**
   * Navigate up through zones or within tracks.
   */
  private navigateUp(): void {
    if (this.focusZone === 'tracks') {
      if (this.selectedTrackIndex > 0) {
        this.selectedTrackIndex--;
        this.ensureTrackVisible();
      } else {
        // Move to actions
        this.focusZone = 'actions';
      }
    } else if (this.focusZone === 'back') {
      // Move to tracks (last item)
      this.focusZone = 'tracks';
      this.selectedTrackIndex = MUSIC_CATALOG.length - 1;
      this.ensureTrackVisible();
    } else if (this.focusZone === 'actions') {
      // Wrap to back
      this.focusZone = 'back';
    }
    this.updateFocusVisuals();
  }

  /**
   * Navigate left within zones.
   */
  private navigateLeft(): void {
    if (this.focusZone === 'actions' && this.selectedActionIndex > 0) {
      this.selectedActionIndex--;
      this.updateFocusVisuals();
    }
  }

  /**
   * Navigate right within zones.
   */
  private navigateRight(): void {
    if (this.focusZone === 'actions' && this.selectedActionIndex < this.actionButtons.length - 1) {
      this.selectedActionIndex++;
      this.updateFocusVisuals();
    }
  }

  /**
   * Activates the currently focused element.
   */
  private activateCurrentSelection(): void {
    switch (this.focusZone) {
      case 'actions':
        this.activateActionButton(this.selectedActionIndex);
        break;
      case 'tracks':
        this.toggleTrack(this.selectedTrackIndex);
        break;
      case 'back':
        this.goBack();
        break;
    }
  }

  /**
   * Returns to the appropriate scene based on returnTo parameter.
   */
  private goBack(): void {
    if (this.returnTo === 'SettingsScene') {
      this.scene.start('SettingsScene', { returnTo: this.originalReturnTo });
    } else {
      this.scene.start('BootScene');
    }
  }

  /**
   * Activates an action button (Select All / Deselect All).
   */
  private activateActionButton(index: number): void {
    const musicManager = getMusicManager();
    if (index === 0) {
      // Select All
      musicManager.enableAllTracks();
    } else {
      // Deselect All
      musicManager.disableAllTracks();
    }
    this.updateAllTrackDisplays();
  }

  /**
   * Toggles a track's enabled state.
   */
  private toggleTrack(index: number): void {
    const track = MUSIC_CATALOG[index];
    if (!track) return;

    const musicManager = getMusicManager();
    musicManager.toggleTrack(track.id);
    this.updateTrackDisplay(track);
  }

  /**
   * Updates the display for a single track.
   */
  private updateTrackDisplay(track: Track): void {
    const musicManager = getMusicManager();
    const elements = this.trackCheckboxes.get(track.id);
    if (elements) {
      const nowEnabled = musicManager.isTrackEnabled(track.id);
      elements.checkbox.setText(nowEnabled ? '[x]' : '[ ]');
      elements.checkbox.setColor(nowEnabled ? '#88ff88' : '#666666');

      const playing = musicManager.getCurrentTrack()?.id === track.id && musicManager.getIsPlaying();
      elements.label.setColor(playing ? '#ffdd44' : nowEnabled ? '#ffffff' : '#666666');
      elements.playingIndicator.setText(playing ? 'PLAYING' : '');
    }
  }

  /**
   * Plays the currently focused track (P key).
   */
  private async playFocusedTrack(): Promise<void> {
    if (this.focusZone !== 'tracks') return;

    const track = MUSIC_CATALOG[this.selectedTrackIndex];
    if (!track) return;

    const musicManager = getMusicManager();

    // If mode is 'off', switch to sequential so we can hear the track
    if (musicManager.getPlaybackMode() === 'off') {
      musicManager.setPlaybackMode('sequential');
    }

    // Play the selected track and wait for it to start
    await musicManager.playTrack(track.id);
    this.updateNowPlaying();
    this.updateAllTrackDisplays();
  }

  /**
   * Ensures the selected track is visible in the scroll area.
   */
  private ensureTrackVisible(): void {
    const trackY = this.selectedTrackIndex * this.trackHeight;
    const visibleTop = this.scrollY;
    const visibleBottom = this.scrollY + this.visibleHeight;

    if (trackY < visibleTop) {
      this.scrollY = trackY;
    } else if (trackY + this.trackHeight > visibleBottom) {
      this.scrollY = trackY + this.trackHeight - this.visibleHeight;
    }

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScrollY);
    this.trackContainer.setY(this.trackListY - this.scrollY);
  }

  /**
   * Updates visual feedback for the current focus state.
   */
  private updateFocusVisuals(): void {
    const musicManager = getMusicManager();

    // Reset action buttons
    this.actionButtons.forEach((button, index) => {
      const isFocused = this.focusZone === 'actions' && this.selectedActionIndex === index;
      button.setColor(isFocused ? '#ffffff' : '#888888');
    });

    // Reset track highlights and selection indicators
    this.trackCheckboxes.forEach((elements, trackId) => {
      const track = MUSIC_CATALOG.find(t => t.id === trackId);
      if (!track) return;
      const trackIndex = MUSIC_CATALOG.indexOf(track);
      const isFocused = this.focusZone === 'tracks' && this.selectedTrackIndex === trackIndex;
      const isEnabled = musicManager.isTrackEnabled(trackId);
      const isPlaying = musicManager.getCurrentTrack()?.id === trackId && musicManager.getIsPlaying();

      // Show/hide the ">" selector indicator
      elements.selector.setText(isFocused ? '>' : '');

      // Set colors based on state
      elements.checkbox.setColor(isEnabled ? '#88ff88' : '#666666');
      elements.label.setColor(isPlaying ? '#ffdd44' : isEnabled ? '#ffffff' : '#666666');
    });

    // Back button
    this.backButton.setColor(this.focusZone === 'back' ? '#ffdd44' : '#888888');
  }

  /**
   * Updates the now playing display.
   */
  private updateNowPlaying(): void {
    const musicManager = getMusicManager();
    const track = musicManager.getCurrentTrack();

    if (musicManager.getPlaybackMode() === 'off') {
      this.nowPlayingText.setText('Music: OFF');
      this.nowPlayingText.setColor('#888888');
    } else if (track && musicManager.getIsPlaying()) {
      this.nowPlayingText.setText(`Now Playing: ${track.title}`);
      this.nowPlayingText.setColor('#88ff88');
    } else {
      this.nowPlayingText.setText('Not playing');
      this.nowPlayingText.setColor('#888888');
    }
  }

  /**
   * Updates all track checkbox and label displays.
   */
  private updateAllTrackDisplays(): void {
    const musicManager = getMusicManager();

    this.trackCheckboxes.forEach((elements, trackId) => {
      const isEnabled = musicManager.isTrackEnabled(trackId);
      const isPlaying = musicManager.getCurrentTrack()?.id === trackId && musicManager.getIsPlaying();

      elements.checkbox.setText(isEnabled ? '[x]' : '[ ]');
      elements.checkbox.setColor(isEnabled ? '#88ff88' : '#666666');
      elements.label.setColor(isPlaying ? '#ffdd44' : isEnabled ? '#ffffff' : '#666666');
      elements.playingIndicator.setText(isPlaying ? 'PLAYING' : '');
    });
  }

  /**
   * Cleanup keyboard handlers when scene shuts down.
   */
  shutdown(): void {
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
}
