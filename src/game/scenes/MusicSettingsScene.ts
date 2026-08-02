/**
 * MusicSettingsScene — track picker. Each track is a slim
 * card row in a scrollable list. Toggle by click; "P" plays focused track.
 */

import Phaser from 'phaser';
import { getMusicManager } from '../../audio/MusicManager';
import { MUSIC_CATALOG, Track } from '../../data/MusicCatalog';
import { transitionToScene, sweepIn } from '../../utils/SceneTransition';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuOverlay, MenuOverlay } from '../../visual/MenuOverlay';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import {
  ACCENT_COLORS,
  ACCENT_COLORS_STR,
  BODY_COLORS,
  TEXT_COLORS,
} from '../../visual/MenuStyle';
import { fitMenuScale, resolveMenuFontScale, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';

/** Design-space units above the track list: title, now-playing line and the action row. */
const MUSIC_LIST_TOP_RESERVE = 170;
/** Design-space units below it: the two scroll hints and the back button. */
const MUSIC_LIST_BOTTOM_RESERVE = 170;
/** The chrome may never take more than this share of the canvas; the list keeps the rest. */
const MUSIC_CHROME_BUDGET_FRACTION = 0.6;

type FocusZone = 'actions' | 'tracks' | 'back';

interface MusicSettingsSceneData {
  returnTo?: 'BootScene' | 'SettingsScene';
  originalReturnTo?: 'BootScene' | 'GameScene';
}

interface TrackRow {
  card: MenuCard;
  selector: Phaser.GameObjects.Text;
  checkbox: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  playingIndicator: Phaser.GameObjects.Text;
}

export class MusicSettingsScene extends Phaser.Scene {
  private returnTo: 'BootScene' | 'SettingsScene' = 'BootScene';
  private originalReturnTo: 'BootScene' | 'GameScene' = 'BootScene';
  private trackRows: Map<string, TrackRow> = new Map();
  private actionButtons: MenuButton[] = [];
  private backButton!: MenuButton;
  private nowPlayingText!: Phaser.GameObjects.Text;
  private scrollY: number = 0;
  private trackContainer!: Phaser.GameObjects.Container;
  private maxScrollY: number = 0;

  private menuOverlay: MenuOverlay | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;

  private focusZone: FocusZone = 'actions';
  private selectedActionIndex: number = 0;
  private selectedTrackIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private menuNavigator: MenuNavigator | null = null;

  private listTop = MUSIC_LIST_TOP_RESERVE;
  private chromeScale = 1;
  private listScale = 1;
  private readonly trackHeight = 38;
  private visibleHeight = 380;

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

    this.actionButtons = [];
    this.trackRows.clear();
    this.focusZone = 'actions';
    this.selectedActionIndex = 0;
    this.selectedTrackIndex = 0;
    this.scrollY = 0;
    const menuScale = resolveMenuFontScale(
      this.scale.width, this.scale.height, getSettingsManager().getUiScale(),
    );
    // Two scales, the way ShopScene split them: the chrome is bound by a vertical budget, while
    // the list is a scroll view, so growing its rows costs only scroll distance.
    this.chromeScale = fitMenuScale(
      menuScale, this.scale.height * MUSIC_CHROME_BUDGET_FRACTION,
      MUSIC_LIST_TOP_RESERVE + MUSIC_LIST_BOTTOM_RESERVE,
    );
    this.listScale = Math.max(1, menuScale);
    this.listTop = scaledInt(this.chromeScale, MUSIC_LIST_TOP_RESERVE);
    this.visibleHeight = Math.max(0, this.scale.height
      - scaledInt(this.chromeScale, MUSIC_LIST_BOTTOM_RESERVE) - this.listTop);

    if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
      musicManager.play();
    }

    sweepIn(this);

    this.menuOverlay = createMenuOverlay(this, { dim: 0.85, drifterCount: 4 });
    this.bgUpdateHandler = (time, delta) => {
      this.menuOverlay?.update(delta);
      const seconds = time / 1000;
      for (const btn of this.actionButtons) btn.tickIdle(seconds);
      this.backButton?.tickIdle(seconds);
    };
    this.events.on('update', this.bgUpdateHandler);

    makeDisplayText(this, centerX, scaledInt(this.chromeScale, 36), 'MUSIC TRACKS', {
      fontSize: scaledInt(this.chromeScale, 32),
      color: ACCENT_COLORS_STR.gold,
      strokeWidth: scaledInt(this.chromeScale, 5),
      letterSpacing: 4 * this.chromeScale,
    });

    this.nowPlayingText = makeBodyText(this, centerX, scaledInt(this.chromeScale, 78), '', {
      fontSize: scaledInt(this.chromeScale, 14),
      color: ACCENT_COLORS_STR.safe,
    });
    this.updateNowPlaying();

    // Action buttons.
    const selectAllButton = createMenuButton({
      scene: this,
      x: centerX - scaledInt(this.chromeScale, 110),
      y: scaledInt(this.chromeScale, 120),
      width: scaledInt(this.chromeScale, 180),
      height: scaledInt(this.chromeScale, 36),
      label: 'SELECT ALL',
      variant: 'primary',
      fontSize: scaledInt(this.chromeScale, 13),
      onActivate: () => this.activateActionButton(0),
    });
    selectAllButton.card.hitZone.on('pointerover', () => {
      this.selectedActionIndex = 0;
      this.menuNavigator?.selectIndex(0);
    });
    const deselectAllButton = createMenuButton({
      scene: this,
      x: centerX + scaledInt(this.chromeScale, 110),
      y: scaledInt(this.chromeScale, 120),
      width: scaledInt(this.chromeScale, 180),
      height: scaledInt(this.chromeScale, 36),
      label: 'DESELECT ALL',
      variant: 'neutral',
      fontSize: scaledInt(this.chromeScale, 13),
      onActivate: () => this.activateActionButton(1),
    });
    deselectAllButton.card.hitZone.on('pointerover', () => {
      this.selectedActionIndex = 1;
      this.menuNavigator?.selectIndex(0);
    });
    this.actionButtons = [selectAllButton, deselectAllButton];

    // Scrollable track list.
    const maskGraphics = this.make.graphics({});
    maskGraphics.fillRect(20, this.listTop, this.cameras.main.width - 40, this.visibleHeight);
    const mask = maskGraphics.createGeometryMask();

    this.trackContainer = this.add.container(0, this.listTop);
    this.trackContainer.setScale(this.listScale);
    this.trackContainer.setMask(mask);

    // Everything below this line is in the container's own units, not screen units.
    const contentWidth = this.scale.width / this.listScale;
    MUSIC_CATALOG.forEach((track, index) => {
      const trackY = index * this.trackHeight + this.trackHeight / 2;
      this.createTrackRow(track, trackY, contentWidth / 2, contentWidth - 60, index);
    });

    const totalHeight = MUSIC_CATALOG.length * this.trackHeight;
    this.maxScrollY = Math.max(0, totalHeight * this.listScale - this.visibleHeight);

    const hintY = this.listTop + this.visibleHeight + scaledInt(this.chromeScale, 14);
    if (this.maxScrollY > 0) {
      makeBodyText(this, centerX, hintY, 'Scroll with mouse wheel or arrow keys', {
        fontSize: scaledInt(this.chromeScale, 11),
        color: TEXT_COLORS.dim,
      });
    }
    makeBodyText(this, centerX, hintY + (this.maxScrollY > 0 ? scaledInt(this.chromeScale, 18) : 0),
      'Press P to play selected track', {
        fontSize: scaledInt(this.chromeScale, 11),
        color: TEXT_COLORS.dim,
      });

    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + deltaY * 0.5, 0, this.maxScrollY);
      this.trackContainer.setY(this.listTop - this.scrollY);
    });

    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: this.cameras.main.height - scaledInt(this.chromeScale, 36),
      width: scaledInt(this.chromeScale, 200),
      height: scaledInt(this.chromeScale, 44),
      label: '← BACK',
      variant: 'neutral',
      fontSize: scaledInt(this.chromeScale, 16),
      onActivate: () => this.goBack(),
    });
    this.backButton.card.hitZone.on('pointerover', () => {
      this.menuNavigator?.selectIndex(1 + MUSIC_CATALOG.length);
    });

    this.time.addEvent({
      delay: 1000,
      callback: this.updateNowPlaying,
      callbackScope: this,
      loop: true,
    });

    this.buildMenuNavigator();
    this.setupKeyboardShortcuts();
    this.updateFocusVisuals();

    this.events.once('shutdown', this.shutdown, this);
  }

  /**
   * Keyboard + gamepad navigation. Items map to:
   * [actions row (left/right swaps SELECT ALL / DESELECT ALL)] +
   * [track rows...] + [back button].
   */
  private buildMenuNavigator(): void {
    this.menuNavigator?.destroy();

    const navigableItems: NavigableItem[] = [];

    navigableItems.push({
      onFocus: () => {
        this.focusZone = 'actions';
        this.updateFocusVisuals();
      },
      onBlur: () => this.updateFocusVisuals(),
      onActivate: () => this.activateActionButton(this.selectedActionIndex),
      onLeft: () => {
        if (this.selectedActionIndex > 0) {
          this.selectedActionIndex--;
          this.updateFocusVisuals();
        }
      },
      onRight: () => {
        if (this.selectedActionIndex < this.actionButtons.length - 1) {
          this.selectedActionIndex++;
          this.updateFocusVisuals();
        }
      },
    });

    MUSIC_CATALOG.forEach((_track, index) => {
      navigableItems.push({
        onFocus: () => {
          this.focusZone = 'tracks';
          this.selectedTrackIndex = index;
          this.ensureTrackVisible();
          this.updateFocusVisuals();
        },
        onBlur: () => this.updateFocusVisuals(),
        onActivate: () => this.toggleTrack(index),
      });
    });

    navigableItems.push({
      onFocus: () => {
        this.focusZone = 'back';
        this.updateFocusVisuals();
      },
      onBlur: () => this.updateFocusVisuals(),
      onActivate: () => this.goBack(),
    });

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: 1,
      wrap: true,
      onCancel: () => this.goBack(),
    });
  }

  private createTrackRow(
    track: Track, y: number, contentCenterX: number, rowWidth: number, index: number,
  ): void {
    const musicManager = getMusicManager();
    const isEnabled = musicManager.isTrackEnabled(track.id);
    const currentTrack = musicManager.getCurrentTrack();
    const isPlaying = currentTrack?.id === track.id && musicManager.getIsPlaying();

    const accent = isEnabled ? ACCENT_COLORS.primary : ACCENT_COLORS.neutral;
    const card = createMenuCard(this, {
      x: contentCenterX,
      y,
      width: rowWidth,
      height: this.trackHeight - 6,
      bodyFillColor: BODY_COLORS.primary,
      accentColor: accent,
      bannerHeight: 0,
      borderWidth: 2,
      borderColor: accent,
      cornerRadius: 8,
      shadowOffsetY: 4,
      shadowAlpha: 0.3,
    });
    if (!isEnabled) card.container.setAlpha(0.7);

    const halfWidth = rowWidth / 2;

    const selector = makeDisplayText(this, -halfWidth + 16, 0, '', {
      fontSize: 14,
      color: ACCENT_COLORS_STR.focus,
      letterSpacing: 1,
    });
    selector.setOrigin(0, 0.5);
    card.frame.add(selector);

    const checkbox = makeDisplayText(this, -halfWidth + 36, 0, isEnabled ? '[x]' : '[ ]', {
      fontSize: 14,
      color: isEnabled ? ACCENT_COLORS_STR.safe : TEXT_COLORS.dim,
      letterSpacing: 1,
    });
    checkbox.setOrigin(0, 0.5);
    card.frame.add(checkbox);

    const label = makeBodyText(this, -halfWidth + 80, 0, track.title, {
      fontSize: 14,
      color: isPlaying ? ACCENT_COLORS_STR.focus : isEnabled ? TEXT_COLORS.body : TEXT_COLORS.dim,
      align: 'left',
    });
    card.frame.add(label);

    const playingIndicator = makeDisplayText(this, halfWidth - 60, 0, isPlaying ? 'PLAYING' : '', {
      fontSize: 11,
      color: ACCENT_COLORS_STR.focus,
      letterSpacing: 1,
    });
    playingIndicator.setOrigin(1, 0.5);
    card.frame.add(playingIndicator);

    card.hitZone.on('pointerover', () => this.menuNavigator?.selectIndex(index + 1));
    card.hitZone.on('pointerdown', () => this.toggleTrack(index));

    this.trackContainer.add(card.container);
    this.trackRows.set(track.id, { card, selector, checkbox, label, playingIndicator });
  }

  private setupKeyboardShortcuts(): void {
    // Navigation/activation lives in MenuNavigator; only the play shortcut
    // stays scene-level.
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault();
        this.playFocusedTrack();
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);
  }

  private goBack(): void {
    if (this.returnTo === 'SettingsScene') {
      transitionToScene(this, 'SettingsScene', { returnTo: this.originalReturnTo });
    } else {
      transitionToScene(this, 'BootScene');
    }
  }

  private activateActionButton(index: number): void {
    const musicManager = getMusicManager();
    if (index === 0) musicManager.enableAllTracks();
    else musicManager.disableAllTracks();
    this.updateAllTrackDisplays();
  }

  private toggleTrack(index: number): void {
    const track = MUSIC_CATALOG[index];
    if (!track) return;
    const musicManager = getMusicManager();
    musicManager.toggleTrack(track.id);
    this.updateTrackDisplay(track);
  }

  private updateTrackDisplay(track: Track): void {
    const musicManager = getMusicManager();
    const elements = this.trackRows.get(track.id);
    if (!elements) return;
    const nowEnabled = musicManager.isTrackEnabled(track.id);
    elements.checkbox.setText(nowEnabled ? '[x]' : '[ ]');
    elements.checkbox.setColor(nowEnabled ? ACCENT_COLORS_STR.safe : TEXT_COLORS.dim);

    const playing = musicManager.getCurrentTrack()?.id === track.id && musicManager.getIsPlaying();
    elements.label.setColor(playing ? ACCENT_COLORS_STR.focus : nowEnabled ? TEXT_COLORS.body : TEXT_COLORS.dim);
    elements.playingIndicator.setText(playing ? 'PLAYING' : '');
    elements.card.container.setAlpha(nowEnabled ? 1 : 0.7);
  }

  private async playFocusedTrack(): Promise<void> {
    if (this.focusZone !== 'tracks') return;
    const track = MUSIC_CATALOG[this.selectedTrackIndex];
    if (!track) return;
    const musicManager = getMusicManager();
    if (musicManager.getPlaybackMode() === 'off') {
      musicManager.setPlaybackMode('sequential');
    }
    await musicManager.playTrack(track.id);
    this.updateNowPlaying();
    this.updateAllTrackDisplays();
  }

  private ensureTrackVisible(): void {
    const rowHeight = this.trackHeight * this.listScale;
    const rowTop = this.selectedTrackIndex * rowHeight;

    if (rowTop < this.scrollY) {
      this.scrollY = rowTop;
    } else if (rowTop + rowHeight > this.scrollY + this.visibleHeight) {
      this.scrollY = rowTop + rowHeight - this.visibleHeight;
    }

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScrollY);
    this.trackContainer.setY(this.listTop - this.scrollY);
  }

  private updateFocusVisuals(): void {
    this.actionButtons.forEach((button, index) => {
      const isFocused = this.focusZone === 'actions' && this.selectedActionIndex === index;
      button.setFocusState(isFocused);
    });

    const musicManager = getMusicManager();
    this.trackRows.forEach((elements, trackId) => {
      const track = MUSIC_CATALOG.find((t) => t.id === trackId);
      if (!track) return;
      const trackIndex = MUSIC_CATALOG.indexOf(track);
      const isFocused = this.focusZone === 'tracks' && this.selectedTrackIndex === trackIndex;
      const isEnabled = musicManager.isTrackEnabled(trackId);
      const isPlaying = musicManager.getCurrentTrack()?.id === trackId && musicManager.getIsPlaying();

      elements.selector.setText(isFocused ? '>' : '');
      elements.checkbox.setColor(isEnabled ? ACCENT_COLORS_STR.safe : TEXT_COLORS.dim);
      elements.label.setColor(isPlaying ? ACCENT_COLORS_STR.focus : isEnabled ? TEXT_COLORS.body : TEXT_COLORS.dim);
      elements.card.setFocusState(isFocused);
    });

    this.backButton.setFocusState(this.focusZone === 'back');
  }

  private updateNowPlaying(): void {
    const musicManager = getMusicManager();
    const track = musicManager.getCurrentTrack();

    if (musicManager.getPlaybackMode() === 'off') {
      this.nowPlayingText.setText('Music: OFF');
      this.nowPlayingText.setColor(TEXT_COLORS.muted);
    } else if (track && musicManager.getIsPlaying()) {
      this.nowPlayingText.setText(`Now Playing: ${track.title}`);
      this.nowPlayingText.setColor(ACCENT_COLORS_STR.safe);
    } else {
      this.nowPlayingText.setText('Not playing');
      this.nowPlayingText.setColor(TEXT_COLORS.muted);
    }
  }

  private updateAllTrackDisplays(): void {
    const musicManager = getMusicManager();
    this.trackRows.forEach((elements, trackId) => {
      const isEnabled = musicManager.isTrackEnabled(trackId);
      const isPlaying = musicManager.getCurrentTrack()?.id === trackId && musicManager.getIsPlaying();
      elements.checkbox.setText(isEnabled ? '[x]' : '[ ]');
      elements.checkbox.setColor(isEnabled ? ACCENT_COLORS_STR.safe : TEXT_COLORS.dim);
      elements.label.setColor(isPlaying ? ACCENT_COLORS_STR.focus : isEnabled ? TEXT_COLORS.body : TEXT_COLORS.dim);
      elements.playingIndicator.setText(isPlaying ? 'PLAYING' : '');
      elements.card.container.setAlpha(isEnabled ? 1 : 0.7);
    });
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
    if (this.bgUpdateHandler) {
      this.events.off('update', this.bgUpdateHandler);
      this.bgUpdateHandler = null;
    }
    this.menuOverlay?.destroy();
    this.menuOverlay = null;
    for (const btn of this.actionButtons) btn.destroy();
    this.actionButtons = [];
    this.backButton?.destroy();
    for (const row of this.trackRows.values()) row.card.destroy();
    this.trackRows.clear();
    this.tweens.killAll();
  }
}
