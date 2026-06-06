/**
 * MusicManager - Manages playlist playback with multiple tracks.
 * Handles sequential/shuffle/off playback modes and track rotation.
 */

import { MUSIC_CATALOG, Track, getTrackPath, getTrackById } from '../data/MusicCatalog';
import { SecureStorage } from '../storage';

// Declare the IBXM globals (loaded from external scripts)
declare class IBXMModule {
  constructor(data: Int8Array);
  songName: string;
  numChannels: number;
  numInstruments: number;
  numPatterns: number;
  sequenceLength: number;
}

declare class IBXMReplay {
  constructor(module: IBXMModule, sampleRate: number);
  getAudio(leftBuffer: Float32Array, rightBuffer: Float32Array, count: number): void;
  setSequencePos(pos: number): void;
  getSamplingRate(): number;
  setInterpolation(enable: boolean): void;
  getSequencePos(): number;
}

export type PlaybackMode = 'sequential' | 'shuffle' | 'off';

const STORAGE_KEY_ENABLED = 'survivor-music-enabled';
const STORAGE_KEY_MODE = 'survivor-music-mode';
const STORAGE_KEY_VOLUME = 'survivor-music-volume';

const DEFAULT_VOLUME = 0.4;

// O(1) membership for load-time validation: the set of real catalog track ids.
const CATALOG_IDS = new Set(MUSIC_CATALOG.map((track) => track.id));

export class MusicManager {
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private replay: IBXMReplay | null = null;
  private module: IBXMModule | null = null;
  private gainNode: GainNode | null = null;

  private isPlaying: boolean = false;
  private volume: number = DEFAULT_VOLUME;
  // Runtime dynamic-intensity multiplier (see setIntensity); not persisted.
  private intensity: number = 1.0;

  private enabledTrackIds: Set<string>;
  private playbackMode: PlaybackMode = 'sequential';
  private currentTrackIndex: number = 0;
  private playlist: Track[] = [];

  private lastSequencePos: number = 0;
  private sequenceCheckInterval: number | null = null;
  private hasLooped: boolean = false;

  constructor() {
    // Load settings from SecureStorage
    this.enabledTrackIds = this.loadEnabledTracks();
    this.playbackMode = this.loadPlaybackMode();
    this.volume = this.loadVolume();

    // Build initial playlist
    this.rebuildPlaylist();
  }

  /**
   * Loads enabled tracks from SecureStorage.
   */
  private loadEnabledTracks(): Set<string> {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_ENABLED);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        // SecureStorage is the anti-cheat layer, so a tampered payload is the
        // threat model. The old `new Set(JSON.parse(...))` accepted anything
        // iterable: a JSON STRING ("hello") is iterable and did NOT throw, so it
        // became a Set of single characters (garbage ids → empty playlist),
        // re-persisted on the next toggle. Rebuild from KNOWN catalog ids only —
        // keep string members that exist in the catalog, dropping non-string
        // junk and stale ids for removed tracks. No-op on the real path (saved
        // ids are always catalog ids). An empty array is a valid "all disabled"
        // state (disableAllTracks writes []) and is preserved; a non-array
        // payload carries no intent → fall through to the all-enabled default.
        if (Array.isArray(parsed)) {
          return new Set(
            parsed.filter((id): id is string => typeof id === 'string' && CATALOG_IDS.has(id))
          );
        }
      }
    } catch {
      console.warn('Could not load music settings');
    }
    // Default: all tracks enabled
    return new Set(CATALOG_IDS);
  }

  /**
   * Saves enabled tracks to SecureStorage.
   */
  private saveEnabledTracks(): void {
    try {
      const ids = Array.from(this.enabledTrackIds);
      SecureStorage.setItem(STORAGE_KEY_ENABLED, JSON.stringify(ids));
    } catch {
      console.warn('Could not save music settings');
    }
  }

  /**
   * Loads playback mode from SecureStorage.
   */
  private loadPlaybackMode(): PlaybackMode {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_MODE);
      if (stored && ['sequential', 'shuffle', 'off'].includes(stored)) {
        return stored as PlaybackMode;
      }
    } catch {
      console.warn('Could not load playback mode');
    }
    return 'sequential';
  }

  /**
   * Saves playback mode to SecureStorage.
   */
  private savePlaybackMode(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_MODE, this.playbackMode);
    } catch {
      console.warn('Could not save playback mode');
    }
  }

  /**
   * Loads volume from SecureStorage.
   */
  private loadVolume(): number {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_VOLUME);
      if (stored !== null) {
        const parsed = parseFloat(stored);
        // SecureStorage is the anti-cheat layer, so an out-of-range/tampered
        // value is the threat model. setVolume clamps to [0,1], but this loader
        // used to return parseFloat(stored) raw — and parseFloat('1e999') is
        // Infinity, parseFloat('loud') is NaN. A non-finite volume reaches
        // `gainNode.gain.value = volume * intensity` (loadTrack/setVolume/
        // setIntensity), where a non-finite AudioParam value throws a TypeError
        // in Web Audio; setIntensity runs every frame via MusicIntensityDriver,
        // so it would be a per-frame exception storm, and getVolume() would feed
        // NaN to the settings slider. Gate on finiteness (→ default), then clamp
        // finite values to the same [0,1] the setter enforces, so the loaded
        // volume is always one setVolume could itself have produced.
        if (Number.isFinite(parsed)) {
          return Math.max(0, Math.min(1, parsed));
        }
      }
    } catch {
      console.warn('Could not load volume');
    }
    return DEFAULT_VOLUME;
  }

  /**
   * Saves volume to SecureStorage.
   */
  private saveVolume(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_VOLUME, this.volume.toString());
    } catch {
      console.warn('Could not save volume');
    }
  }

  /**
   * Rebuilds the playlist from enabled tracks.
   */
  private rebuildPlaylist(): void {
    this.playlist = MUSIC_CATALOG.filter((track) => this.enabledTrackIds.has(track.id));

    if (this.playbackMode === 'shuffle') {
      this.shufflePlaylist();
    }
  }

  /**
   * Shuffles the playlist using Fisher-Yates algorithm.
   */
  private shufflePlaylist(): void {
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    }
  }

  /**
   * Checks if a track is enabled in the rotation.
   */
  isTrackEnabled(trackId: string): boolean {
    return this.enabledTrackIds.has(trackId);
  }

  /**
   * Enables or disables a track in the rotation.
   */
  setTrackEnabled(trackId: string, enabled: boolean): void {
    if (enabled) {
      this.enabledTrackIds.add(trackId);
    } else {
      this.enabledTrackIds.delete(trackId);
    }
    this.saveEnabledTracks();
    this.rebuildPlaylist();
  }

  /**
   * Toggles a track's enabled state.
   */
  toggleTrack(trackId: string): void {
    this.setTrackEnabled(trackId, !this.isTrackEnabled(trackId));
  }

  /**
   * Enables all tracks in the catalog.
   */
  enableAllTracks(): void {
    MUSIC_CATALOG.forEach((track) => this.enabledTrackIds.add(track.id));
    this.saveEnabledTracks();
    this.rebuildPlaylist();
  }

  /**
   * Disables all tracks in the catalog.
   */
  disableAllTracks(): void {
    this.enabledTrackIds.clear();
    this.saveEnabledTracks();
    this.rebuildPlaylist();
  }

  /**
   * Gets the current playback mode.
   */
  getPlaybackMode(): PlaybackMode {
    return this.playbackMode;
  }

  /**
   * Sets the playback mode.
   */
  setPlaybackMode(mode: PlaybackMode): void {
    this.playbackMode = mode;
    this.savePlaybackMode();

    if (mode === 'off') {
      this.stop();
    } else {
      this.rebuildPlaylist();
    }
  }

  /**
   * Gets all tracks with their enabled status.
   */
  getAllTracks(): Array<Track & { enabled: boolean }> {
    return MUSIC_CATALOG.map((track) => ({
      ...track,
      enabled: this.enabledTrackIds.has(track.id),
    }));
  }

  /**
   * Gets the currently playing track.
   */
  getCurrentTrack(): Track | null {
    if (this.playlist.length === 0) return null;
    return this.playlist[this.currentTrackIndex] || null;
  }

  /**
   * Loads a track by index.
   */
  private async loadTrack(index: number): Promise<void> {
    if (this.playlist.length === 0) return;

    this.currentTrackIndex = index % this.playlist.length;
    const track = this.playlist[this.currentTrackIndex];
    const url = getTrackPath(track);

    try {
      if (typeof IBXMModule === 'undefined') {
        throw new Error('IBXM library not loaded');
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const data = new Int8Array(arrayBuffer);

      this.module = new IBXMModule(data);

      // Initialize audio context if needed
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      this.replay = new IBXMReplay(this.module, this.audioContext.sampleRate);
      this.replay.setInterpolation(true);

      // Create gain node if needed
      if (!this.gainNode) {
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.volume;
        this.gainNode.connect(this.audioContext.destination);
      }

      // Create new script processor
      if (this.scriptProcessor) {
        try {
          this.scriptProcessor.disconnect();
        } catch {
          // Already disconnected
        }
      }

      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 0, 2);
      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this.replay || !this.isPlaying) {
          const leftBuf = event.outputBuffer.getChannelData(0);
          const rightBuf = event.outputBuffer.getChannelData(1);
          for (let i = 0; i < leftBuf.length; i++) {
            leftBuf[i] = 0;
            rightBuf[i] = 0;
          }
          return;
        }

        const leftBuf = event.outputBuffer.getChannelData(0);
        const rightBuf = event.outputBuffer.getChannelData(1);
        this.replay.getAudio(leftBuf, rightBuf, leftBuf.length);
      };

    } catch (error) {
      console.error('Failed to load track:', error);
      throw error;
    }
  }

  /**
   * Starts playback from the beginning or current track.
   */
  async play(): Promise<void> {
    if (this.playbackMode === 'off') return;
    if (this.playlist.length === 0) {
      console.warn('No tracks in playlist');
      return;
    }

    // Load current track if not loaded
    if (!this.module || !this.replay) {
      await this.loadTrack(this.currentTrackIndex);
    }

    if (!this.audioContext || !this.scriptProcessor || !this.gainNode || !this.replay) {
      console.warn('Audio not initialized');
      return;
    }

    this.replay.setSequencePos(0);
    this.lastSequencePos = 0;
    this.hasLooped = false;

    await this.audioContext.resume();
    this.scriptProcessor.connect(this.gainNode);
    this.isPlaying = true;

    // Start checking for track end
    this.startTrackEndDetection();
  }

  /**
   * Starts polling to detect when track loops (ends).
   */
  private startTrackEndDetection(): void {
    if (this.sequenceCheckInterval) {
      clearInterval(this.sequenceCheckInterval);
    }

    this.sequenceCheckInterval = window.setInterval(() => {
      if (!this.replay || !this.isPlaying) return;

      const currentPos = this.replay.getSequencePos();

      // Detect loop: position went backwards significantly
      if (currentPos < this.lastSequencePos - 1 && this.lastSequencePos > 2) {
        if (!this.hasLooped) {
          this.hasLooped = true;
          this.nextTrack();
        }
      }

      this.lastSequencePos = currentPos;
    }, 500);
  }

  /**
   * Stops playback.
   */
  stop(): void {
    if (this.sequenceCheckInterval) {
      clearInterval(this.sequenceCheckInterval);
      this.sequenceCheckInterval = null;
    }

    if (!this.scriptProcessor || !this.gainNode) return;

    try {
      this.scriptProcessor.disconnect(this.gainNode);
    } catch {
      // Already disconnected
    }
    this.isPlaying = false;
  }

  /**
   * Advances to the next track.
   */
  async nextTrack(): Promise<void> {
    this.stop();

    // Clear current audio state
    this.module = null;
    this.replay = null;

    // Rebuild playlist to pick up any track selection changes
    this.rebuildPlaylist();

    if (this.playlist.length === 0) {
      console.warn('No tracks in playlist');
      return;
    }

    // Advance index
    this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;

    // If we've gone through all tracks in shuffle mode, reshuffle
    if (this.currentTrackIndex === 0 && this.playbackMode === 'shuffle') {
      this.shufflePlaylist();
    }

    await this.play();
  }

  /**
   * Goes to the previous track.
   */
  async previousTrack(): Promise<void> {
    if (this.playlist.length === 0) return;

    this.stop();
    this.module = null;
    this.replay = null;

    this.currentTrackIndex =
      (this.currentTrackIndex - 1 + this.playlist.length) % this.playlist.length;

    await this.play();
  }

  /**
   * Plays a specific track by ID.
   */
  async playTrack(trackId: string): Promise<void> {
    const track = getTrackById(trackId);
    if (!track) {
      console.warn('Track not found:', trackId);
      return;
    }

    // Enable the track if not already
    if (!this.enabledTrackIds.has(trackId)) {
      this.setTrackEnabled(trackId, true);
    }

    // Find index in playlist
    const index = this.playlist.findIndex((t) => t.id === trackId);
    if (index === -1) {
      console.warn('Track not in playlist:', trackId);
      return;
    }

    this.stop();
    this.module = null;
    this.replay = null;
    this.currentTrackIndex = index;

    await this.play();
  }

  /**
   * Sets playback volume (0.0 to 1.0).
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume * this.intensity;
    }
    this.saveVolume();
  }

  /**
   * Dynamic-intensity multiplier layered on top of the user volume. Driven by
   * MusicIntensityDriver so the soundtrack swells during high-combat moments
   * (combo, enemy density, low HP, boss) and settles when calm. Subtle by
   * design (~0.5x..1.15x). Does not persist — purely a runtime envelope.
   */
  setIntensity(multiplier: number): void {
    this.intensity = Math.max(0, multiplier);
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume * this.intensity;
    }
  }

  /**
   * Gets current volume.
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Returns true if music is currently playing.
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Gets the number of enabled tracks.
   */
  getEnabledTrackCount(): number {
    return this.enabledTrackIds.size;
  }

  /**
   * Cleans up resources.
   */
  destroy(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.scriptProcessor = null;
    this.replay = null;
    this.module = null;
    this.gainNode = null;
  }
}

// Singleton instance
let musicManagerInstance: MusicManager | null = null;

export function getMusicManager(): MusicManager {
  if (!musicManagerInstance) {
    musicManagerInstance = new MusicManager();
  }
  return musicManagerInstance;
}
