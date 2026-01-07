import Phaser from 'phaser';
import { getSettingsManager } from '../settings';

/**
 * Sound effect keys - matches asset keys loaded in BootScene.
 */
export const SoundKeys = {
  HIT: 'sfx_hit',
  PICKUP_XP: 'sfx_pickup_xp',
  PICKUP_HEALTH: 'sfx_pickup_health',
  LEVEL_UP: 'sfx_levelup',
  PLAYER_HURT: 'sfx_player_hurt',
} as const;

/**
 * C Major Pentatonic Scale - pitch ratios for Phaser's rate parameter.
 * This scale has no dissonant intervals, so any combination sounds pleasant.
 * Two octaves: C3 through E5
 */
const PENTATONIC_SCALE = [
  0.500,  // C3 (index 0)
  0.561,  // D3 (index 1)
  0.630,  // E3 (index 2)
  0.749,  // G3 (index 3)
  0.841,  // A3 (index 4)
  1.000,  // C4 (index 5) - root
  1.122,  // D4 (index 6)
  1.260,  // E4 (index 7)
  1.498,  // G4 (index 8)
  1.682,  // A4 (index 9)
  2.000,  // C5 (index 10)
  2.245,  // D5 (index 11)
  2.520,  // E5 (index 12)
];

// Scale ranges for different sound categories
const XP_SCALE_START = 5;   // C4 - bright, chime-like range
const XP_SCALE_END = 12;    // E5
const COMBAT_SCALE_START = 0;  // C3 - punchy, low range
const COMBAT_SCALE_END = 8;    // G4

// Dissonant note for player hurt (Bb3 - outside pentatonic for warning)
const DISSONANT_WARNING = 0.944;

/**
 * SoundManager handles all game sound effects.
 * Separate from MusicManager to allow independent control.
 * Settings are persisted via SettingsManager.
 *
 * Uses Phaser's sound system which coexists with the IBXM music player.
 */
export class SoundManager {
  private scene: Phaser.Scene;

  // Throttling for rapid sounds
  private lastHitTime: number = 0;
  private readonly HIT_SOUND_COOLDOWN = 50; // ms between hit sounds

  // XP melody state - creates ascending/descending wind-chime patterns
  private xpNoteIndex: number = XP_SCALE_START;
  private xpDirection: number = 1; // 1 = ascending, -1 = descending
  private lastXpTime: number = 0;
  private readonly XP_MELODY_RESET_MS = 500; // Gap before starting new melody

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Play a sound effect by key.
   * Checks settings on each call to respect changes made in SettingsScene.
   * @param key - Sound key from SoundKeys
   * @param config - Optional Phaser sound config (volume, rate, etc.)
   */
  play(key: string, config?: Phaser.Types.Sound.SoundConfig): void {
    // Check settings manager each time to respect live changes
    const settings = getSettingsManager();
    if (!settings.isSfxEnabled()) return;

    const volume = settings.getSfxVolume();

    try {
      this.scene.sound.play(key, {
        volume: volume,
        ...config,
      });
    } catch (error) {
      // Sound might not be loaded yet, fail silently
      console.warn(`Sound not found: ${key}`);
    }
  }

  /**
   * Play hit sound tuned to pentatonic scale.
   * Keeps combat punchy while staying harmonious with other sounds.
   * Throttled to prevent audio overload.
   */
  playHit(): void {
    const now = Date.now();
    if (now - this.lastHitTime < this.HIT_SOUND_COOLDOWN) {
      return;
    }
    this.lastHitTime = now;

    // Select random note from combat range (C3-G4 for punchy, low-mid tones)
    const noteIndex = COMBAT_SCALE_START + Math.floor(Math.random() * (COMBAT_SCALE_END - COMBAT_SCALE_START + 1));
    const rate = PENTATONIC_SCALE[noteIndex];

    this.play(SoundKeys.HIT, { rate });
  }

  /**
   * Play XP pickup with pentatonic melody - creates wind-chime effect.
   * Sequential notes create ascending/descending patterns that always sound pleasant.
   * Higher XP values jump multiple notes for extra excitement.
   */
  playPickupXP(xpValue: number = 1): void {
    const now = Date.now();

    // Reset melody if there's been a gap (new collection session)
    if (now - this.lastXpTime > this.XP_MELODY_RESET_MS) {
      // Randomly start ascending or descending
      this.xpDirection = Math.random() > 0.5 ? 1 : -1;
      this.xpNoteIndex = this.xpDirection > 0 ? XP_SCALE_START : XP_SCALE_END;
    }

    this.lastXpTime = now;

    // Higher XP values jump multiple notes (more exciting)
    const noteJump = Math.min(3, Math.max(1, Math.ceil(xpValue / 10)));

    // Move through the scale
    this.xpNoteIndex += this.xpDirection * noteJump;

    // Bounce at scale boundaries to create ascending/descending waves
    if (this.xpNoteIndex >= XP_SCALE_END) {
      this.xpNoteIndex = XP_SCALE_END;
      this.xpDirection = -1;
    } else if (this.xpNoteIndex <= XP_SCALE_START) {
      this.xpNoteIndex = XP_SCALE_START;
      this.xpDirection = 1;
    }

    const rate = PENTATONIC_SCALE[this.xpNoteIndex];

    // Add micro-variation (1%) for organic, natural feel
    const microVariation = 1 + (Math.random() - 0.5) * 0.01;

    this.play(SoundKeys.PICKUP_XP, { rate: rate * microVariation });
  }

  /**
   * Play health pickup as harmonious interval (perfect fifth: C4 + G4).
   * The two notes together create a warm, healing-feeling chord.
   */
  playPickupHealth(): void {
    const volume = getSettingsManager().getSfxVolume();

    // Play root note (C4)
    this.play(SoundKeys.PICKUP_HEALTH, { rate: PENTATONIC_SCALE[5] }); // C4 = 1.0

    // Play fifth slightly delayed for chord effect (G4)
    this.scene.time.delayedCall(50, () => {
      this.play(SoundKeys.PICKUP_HEALTH, {
        rate: PENTATONIC_SCALE[8], // G4 = 1.498
        volume: volume * 0.8, // Slightly quieter for balance
      });
    });
  }

  /**
   * Play level up as ascending arpeggio (C4 -> E4 -> G4 -> C5).
   * Creates a triumphant, satisfying musical flourish.
   */
  playLevelUp(): void {
    const volume = getSettingsManager().getSfxVolume();

    // Ascending arpeggio notes with delays
    const arpeggioNotes = [
      { rate: PENTATONIC_SCALE[5], delay: 0 },    // C4
      { rate: PENTATONIC_SCALE[7], delay: 60 },   // E4
      { rate: PENTATONIC_SCALE[8], delay: 120 },  // G4
      { rate: PENTATONIC_SCALE[10], delay: 180 }, // C5 (octave)
    ];

    for (const note of arpeggioNotes) {
      if (note.delay === 0) {
        // Play first note immediately
        this.play(SoundKeys.LEVEL_UP, { rate: note.rate, volume: volume * 1.2 });
      } else {
        // Schedule subsequent notes with slight crescendo
        this.scene.time.delayedCall(note.delay, () => {
          const crescendoVolume = volume * (1.2 + note.delay * 0.001);
          this.play(SoundKeys.LEVEL_UP, { rate: note.rate, volume: crescendoVolume });
        });
      }
    }
  }

  /**
   * Play player hurt with dissonant warning tone.
   * Uses Bb3 (outside pentatonic) to grab attention and signal danger.
   */
  playPlayerHurt(): void {
    const volume = getSettingsManager().getSfxVolume();
    // Bb3 is slightly outside our pentatonic scale, creating intentional tension
    this.play(SoundKeys.PLAYER_HURT, {
      rate: DISSONANT_WARNING,
      volume: volume * 1.1, // Slightly louder to ensure it's noticed
    });
  }

  /**
   * Set the master volume for all sound effects.
   * Persists to SettingsManager.
   * @param volume - Volume from 0 to 1
   */
  setVolume(volume: number): void {
    getSettingsManager().setSfxVolume(Phaser.Math.Clamp(volume, 0, 1));
  }

  /**
   * Get current volume level.
   */
  getVolume(): number {
    return getSettingsManager().getSfxVolume();
  }

  /**
   * Enable or disable all sound effects.
   * Persists to SettingsManager.
   */
  setEnabled(enabled: boolean): void {
    getSettingsManager().setSfxEnabled(enabled);
  }

  /**
   * Check if sound effects are enabled.
   */
  isEnabled(): boolean {
    return getSettingsManager().isSfxEnabled();
  }
}
