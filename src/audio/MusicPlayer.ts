/**
 * MusicPlayer - Wrapper for IBXM tracker music playback.
 * Plays .xm, .mod, .s3m tracker files using Web Audio API.
 */

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
}

export class MusicPlayer {
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private replay: IBXMReplay | null = null;
  private module: IBXMModule | null = null;
  private isPlaying: boolean = false;
  private volume: number = 0.5;
  private gainNode: GainNode | null = null;

  /**
   * Loads a tracker module from a URL.
   */
  async load(url: string): Promise<void> {
    try {
      // Check if IBXM library is loaded
      if (typeof IBXMModule === 'undefined') {
        throw new Error('IBXM library not loaded. Make sure /lib/IBXM.js is included.');
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load music: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const data = new Int8Array(arrayBuffer);

      // Create module and replay instances
      this.module = new IBXMModule(data);

      // Initialize audio context
      this.audioContext = new AudioContext();
      this.replay = new IBXMReplay(this.module, this.audioContext.sampleRate);
      this.replay.setInterpolation(true);

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.audioContext.destination);

      // Create script processor for audio generation
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 0, 2);
      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this.replay || !this.isPlaying) {
          // Fill with silence
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
      console.error('Failed to load music:', error);
      throw error;
    }
  }

  /**
   * Starts playback.
   */
  play(): void {
    if (!this.audioContext || !this.scriptProcessor || !this.gainNode || !this.replay) {
      console.warn('Music not loaded yet');
      return;
    }

    // Start from beginning
    this.replay.setSequencePos(0);

    // Resume audio context (required after user interaction)
    this.audioContext.resume().then(() => {
    });

    this.scriptProcessor.connect(this.gainNode);
    this.isPlaying = true;
  }

  /**
   * Stops playback.
   */
  stop(): void {
    if (!this.scriptProcessor || !this.gainNode) return;

    try {
      this.scriptProcessor.disconnect(this.gainNode);
    } catch {
      // Already disconnected
    }
    this.isPlaying = false;
  }

  /**
   * Pauses playback (same as stop for tracker music).
   */
  pause(): void {
    this.stop();
  }

  /**
   * Resumes playback from the beginning.
   */
  resume(): void {
    if (this.replay) {
      this.replay.setSequencePos(0);
    }
    this.play();
  }

  /**
   * Sets playback volume (0.0 to 1.0).
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
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
   * Gets the song name.
   */
  getSongName(): string {
    return this.module?.songName || 'Unknown';
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

// Singleton instance for global music
let globalMusicPlayer: MusicPlayer | null = null;

export function getMusicPlayer(): MusicPlayer {
  if (!globalMusicPlayer) {
    globalMusicPlayer = new MusicPlayer();
  }
  return globalMusicPlayer;
}
