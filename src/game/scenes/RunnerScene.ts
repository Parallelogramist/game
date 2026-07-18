/**
 * RunnerScene — endless-runner game mode (Area C of the 2026-05-29 scroll
 * runner design doc), v1 vertical slice.
 *
 * CONTAINMENT FIRST: this scene is fully additive. It deliberately does NOT
 * touch the shared bitECS world/systems (they carry module-level state that
 * is reset and scene-bound by GameScene — setEnemyAIBounds, setBossArenaScene,
 * setTelegraphManager, resetAllRunSystems, ...). Driving those from a second
 * scene risks corrupting GameScene's expectations, so the runner keeps its
 * entities as plain TypeScript arrays of structs updated in a single loop.
 *
 * Reused (instance-scoped or read-only APIs, no modifications):
 *   - PlayerSpaceship        (player visual)
 *   - ParallaxBackground     (scroll-flavored star drift, per-scene instance)
 *   - createCachedEnemyVisual + ENEMY_TYPES (enemy looks + base stats)
 *   - JoystickManager        (touch movement, scene-scoped)
 *   - HudScale / SceneTransition / DepthLayers / NeonColors / SettingsManager
 *   - SecureStorage via runner/RunnerBestScore (best-score persistence)
 *
 * Orientation: the scroll axis follows the long screen axis, read at
 * create(). Landscape → enemies flow right-to-left, ship faces right.
 * Portrait → enemies flow top-to-bottom, ship faces up. An orientation flip
 * restarts the scene via main.ts's orientation watcher (same treatment as
 * the menu scenes), which restarts the run.
 */

import Phaser from 'phaser';
import { PlayerSpaceship } from '../../visual/PlayerSpaceship';
import { ParallaxBackground } from '../../visual/ParallaxBackground';
import { createCachedEnemyVisual } from '../../visual/EnemyVisuals';
import { PLAYER_NEON, toNeonPair } from '../../visual/NeonColors';
import { DepthLayers, OverlayDepths } from '../../visual/DepthLayers';
import { getEnemyType } from '../../enemies/EnemyTypes';
import { JoystickManager } from '../../ui/JoystickManager';
import { computeHudScale, scaledFontPx, scaledInt } from '../../utils/HudScale';
import { fadeIn, fadeOut, addButtonInteraction } from '../../utils/SceneTransition';
import { getSettingsManager } from '../../settings';
import {
  computeScore,
  distanceToMeters,
  pickSpawnEntry,
  scrollSpeedForDistance,
  spawnIntervalForDistance,
} from '../runner/runnerMath';
import { loadRunnerBest, saveRunnerBestIfHigher } from '../runner/RunnerBestScore';
import { recordRunnerRun } from '../runner/RunnerLeaderboard';

// ─── Runner-local tuning (visual/feel constants live here; pacing math in runnerMath) ───
const PLAYER_SPEED = 320;          // px/s free movement
const PLAYER_RADIUS = 14;          // collision radius
const PLAYER_MAX_HP = 3;           // contact hits before death
const INVULN_SECONDS = 1.2;        // post-hit invulnerability
const EDGE_MARGIN = 26;            // player clamp inset from screen edges
const FIRE_INTERVAL = 0.28;        // seconds between auto-shots
const PROJECTILE_SPEED = 560;      // px/s
const PROJECTILE_DAMAGE = 10;
const PROJECTILE_RADIUS = 4;
const PROJECTILE_POOL_SIZE = 40;   // pooled — no per-shot allocation
const SPAWN_PAD = 48;              // spawn distance beyond the forward edge
const DESPAWN_PAD = 80;            // despawn distance beyond the back edge
const CROSS_SPAWN_INSET = 40;      // keep spawns off the cross-axis edges
const HUD_REFRESH_SECONDS = 0.1;   // HUD text update throttle
const RESULTS_DELAY_MS = 900;      // pause on the death moment before results
const RUNNER_QUALITY = 'high' as const;
const HUD_FONT = 'Courier New, monospace';

interface RunnerEnemy {
  sprite: Phaser.GameObjects.Container;
  x: number;
  y: number;
  crossBase: number;      // cross-axis anchor the wobble oscillates around
  radius: number;
  hp: number;
  speedFactor: number;
  wobbleAmplitude: number;
  wobbleSpeed: number;
  wobblePhase: number;
}

interface RunnerProjectile {
  sprite: Phaser.GameObjects.Arc;
  active: boolean;
  x: number;
  y: number;
}

export class RunnerScene extends Phaser.Scene {
  // Visual managers (per-scene instances of shared classes)
  private playerShip: PlayerSpaceship | null = null;
  private parallax: ParallaxBackground | null = null;
  private joystick: JoystickManager | null = null;

  // Input
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasdKeys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key> | null = null;

  // Run state — class property initializers only run once per Scene instance,
  // so EVERY field below is re-assigned in create() (scene restarts reuse the
  // instance; stale state must not leak between runs).
  private isPortrait = false;
  private alive = true;
  private isPaused = false;
  private resultsShown = false;
  private leavingScene = false;
  private distance = 0;
  private kills = 0;
  private playerHp = PLAYER_MAX_HP;
  private playerX = 0;
  private playerY = 0;
  private invulnTimer = 0;
  private fireTimer = 0;
  private spawnTimer = 0;
  private hudRefreshTimer = 0;
  private bestScore = 0;

  // Entities (plain arrays of structs — see containment note above)
  private enemies: RunnerEnemy[] = [];
  private projectiles: RunnerProjectile[] = [];

  // HUD / overlays
  private distanceText: Phaser.GameObjects.Text | null = null;
  private scoreText: Phaser.GameObjects.Text | null = null;
  private killsText: Phaser.GameObjects.Text | null = null;
  private heartsText: Phaser.GameObjects.Text | null = null;
  private bestText: Phaser.GameObjects.Text | null = null;
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private resultsOverlay: Phaser.GameObjects.Container | null = null;
  private resultsDim: Phaser.GameObjects.Rectangle | null = null;

  constructor() {
    super({ key: 'RunnerScene' });
  }

  create(): void {
    // Phaser does not auto-call shutdown() on restart — without this listener
    // input handlers and tweens accumulate across runs.
    this.events.once('shutdown', this.shutdown, this);
    this.scale.on('resize', this.handleResize, this);

    // ── Full run-state reset (instance is reused across restarts) ──
    this.isPortrait = this.scale.height > this.scale.width;
    this.alive = true;
    this.isPaused = false;
    this.resultsShown = false;
    this.leavingScene = false;
    this.distance = 0;
    this.kills = 0;
    this.playerHp = PLAYER_MAX_HP;
    this.invulnTimer = 0;
    this.fireTimer = 0;
    this.spawnTimer = spawnIntervalForDistance(0);
    this.hudRefreshTimer = 0;
    this.enemies = [];
    this.projectiles = [];
    this.pauseOverlay = null;
    this.resultsOverlay = null;
    this.resultsDim = null;
    this.bestScore = loadRunnerBest();

    // ── Background ──
    this.parallax = new ParallaxBackground(this);
    this.parallax.setQuality(RUNNER_QUALITY);

    // ── Player ship ──
    const width = this.scale.width;
    const height = this.scale.height;
    if (this.isPortrait) {
      this.playerX = width / 2;
      this.playerY = height * 0.8;
    } else {
      this.playerX = width * 0.18;
      this.playerY = height / 2;
    }
    this.playerShip = new PlayerSpaceship(this, this.playerX, this.playerY, {
      baseRadius: PLAYER_RADIUS,
      neonColor: PLAYER_NEON,
      quality: RUNNER_QUALITY,
    });
    // Prime the ship's facing toward the scroll direction (its rotation is
    // velocity-driven and there is no public "set angle" — feeding a few
    // zero-render pre-updates converges it before the first frame).
    const forward = this.forwardDir();
    for (let i = 0; i < 40; i++) {
      this.playerShip.update(forward.x * 200, forward.y * 200, 0.05);
    }
    this.playerShip.getContainer().setPosition(this.playerX, this.playerY);

    // ── Input ──
    this.joystick = new JoystickManager(this);
    this.cursors = this.input.keyboard?.createCursorKeys() ?? null;
    this.wasdKeys = (this.input.keyboard?.addKeys('W,A,S,D') as Record<
      'W' | 'A' | 'S' | 'D',
      Phaser.Input.Keyboard.Key
    >) ?? null;
    this.input.keyboard?.on('keydown-ESC', this.onEscKey, this);
    this.input.keyboard?.on('keydown-R', this.onRestartKey, this);
    this.input.keyboard?.on('keydown-ENTER', this.onRestartKey, this);
    this.input.keyboard?.on('keydown-SPACE', this.onRestartKey, this);
    this.input.keyboard?.on('keydown-M', this.onMenuKey, this);

    // ── Projectile pool (pre-allocated — no create/destroy churn in the loop) ──
    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const arc = this.add.circle(0, 0, PROJECTILE_RADIUS, 0x66ddff, 1);
      arc.setStrokeStyle(2, 0xaaffff, 0.9);
      arc.setDepth(DepthLayers.PROJECTILES);
      arc.setVisible(false);
      this.projectiles.push({ sprite: arc, active: false, x: 0, y: 0 });
    }

    // ── HUD ──
    this.createHud();
    this.refreshHud();

    fadeIn(this, 300);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Update loop
  // ────────────────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    // Phaser delta is ms; clamp tab-switch spikes, convert to seconds.
    const dt = Math.min(delta, 50) * 0.001;

    this.joystick?.setEnabled(this.alive && !this.isPaused);

    // Parallax keeps its ambient drift alive on the results screen; the fake
    // "player position" advances with scrolled distance so the star layers
    // stream against the scroll direction.
    const forward = this.forwardDir();
    this.parallax?.update(
      this.isPaused ? 0 : dt,
      this.scale.width / 2 + forward.x * this.distance,
      this.scale.height / 2 + forward.y * this.distance
    );

    if (this.isPaused || !this.alive) return;

    const scrollSpeed = scrollSpeedForDistance(this.distance);
    this.distance += scrollSpeed * dt;

    this.updatePlayer(dt);
    this.updateAutoFire(dt, forward);
    this.updateProjectiles(dt, forward);
    this.updateSpawning(dt);
    this.updateEnemies(dt, scrollSpeed);

    this.hudRefreshTimer -= dt;
    if (this.hudRefreshTimer <= 0) {
      this.hudRefreshTimer = HUD_REFRESH_SECONDS;
      this.refreshHud();
    }
  }

  /** Unit vector of the ship's travel direction (opposite the enemy flow). */
  private forwardDir(): { x: number; y: number } {
    return this.isPortrait ? { x: 0, y: -1 } : { x: 1, y: 0 };
  }

  private updatePlayer(dt: number): void {
    if (!this.playerShip) return;

    let inputX = 0;
    let inputY = 0;
    if (this.cursors) {
      if (this.cursors.left.isDown) inputX -= 1;
      if (this.cursors.right.isDown) inputX += 1;
      if (this.cursors.up.isDown) inputY -= 1;
      if (this.cursors.down.isDown) inputY += 1;
    }
    if (this.wasdKeys) {
      if (this.wasdKeys.A.isDown) inputX -= 1;
      if (this.wasdKeys.D.isDown) inputX += 1;
      if (this.wasdKeys.W.isDown) inputY -= 1;
      if (this.wasdKeys.S.isDown) inputY += 1;
    }
    if (this.joystick?.isActive()) {
      const dir = this.joystick.getDirection();
      inputX += dir.x;
      inputY += dir.y;
    }

    const magnitude = Math.sqrt(inputX * inputX + inputY * inputY);
    if (magnitude > 1) {
      inputX /= magnitude;
      inputY /= magnitude;
    }

    const velocityX = inputX * PLAYER_SPEED;
    const velocityY = inputY * PLAYER_SPEED;
    this.playerX += velocityX * dt;
    this.playerY += velocityY * dt;

    // Clamp to the live screen size (EXPAND mode can resize mid-run).
    this.playerX = Phaser.Math.Clamp(this.playerX, EDGE_MARGIN, this.scale.width - EDGE_MARGIN);
    this.playerY = Phaser.Math.Clamp(this.playerY, EDGE_MARGIN, this.scale.height - EDGE_MARGIN);

    // Feed the ship a small forward bias when idle so it keeps facing the
    // travel direction instead of snapping toward pure cross-axis dodges.
    const forward = this.forwardDir();
    const visualVx = velocityX + forward.x * 40;
    const visualVy = velocityY + forward.y * 40;
    this.playerShip.update(visualVx, visualVy, dt);
    this.playerShip.getContainer().setPosition(this.playerX, this.playerY);

    if (this.invulnTimer > 0) {
      this.invulnTimer -= dt;
      if (this.invulnTimer <= 0) {
        this.playerShip.setInvulnerable(false);
      }
    }
  }

  private updateAutoFire(dt: number, forward: { x: number; y: number }): void {
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    this.fireTimer = FIRE_INTERVAL;

    for (const projectile of this.projectiles) {
      if (projectile.active) continue;
      projectile.active = true;
      projectile.x = this.playerX + forward.x * (PLAYER_RADIUS + 8);
      projectile.y = this.playerY + forward.y * (PLAYER_RADIUS + 8);
      projectile.sprite.setPosition(projectile.x, projectile.y);
      projectile.sprite.setVisible(true);
      return;
    }
    // Pool exhausted — skip the shot (never allocate in the loop).
  }

  private updateProjectiles(dt: number, forward: { x: number; y: number }): void {
    const width = this.scale.width;
    const height = this.scale.height;
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      projectile.x += forward.x * PROJECTILE_SPEED * dt;
      projectile.y += forward.y * PROJECTILE_SPEED * dt;

      if (
        projectile.x < -PROJECTILE_RADIUS * 4 || projectile.x > width + PROJECTILE_RADIUS * 4 ||
        projectile.y < -PROJECTILE_RADIUS * 4 || projectile.y > height + PROJECTILE_RADIUS * 4
      ) {
        this.recycleProjectile(projectile);
        continue;
      }

      // Projectile ↔ enemy collision (counts are small; O(n·m) is fine here)
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];
        const dx = enemy.x - projectile.x;
        const dy = enemy.y - projectile.y;
        const hitRange = enemy.radius + PROJECTILE_RADIUS;
        if (dx * dx + dy * dy <= hitRange * hitRange) {
          this.recycleProjectile(projectile);
          enemy.hp -= PROJECTILE_DAMAGE;
          if (enemy.hp <= 0) {
            this.kills++;
            this.despawnEnemy(i, true);
          }
          break;
        }
      }

      projectile.sprite.setPosition(projectile.x, projectile.y);
    }
  }

  private recycleProjectile(projectile: RunnerProjectile): void {
    projectile.active = false;
    projectile.sprite.setVisible(false);
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = spawnIntervalForDistance(this.distance);
    this.spawnEnemy();
  }

  private spawnEnemy(): void {
    const entry = pickSpawnEntry(this.distance, Math.random());
    const enemyType = getEnemyType(entry.typeId);
    if (!enemyType) return; // roster/typo safety — never crash the run

    const width = this.scale.width;
    const height = this.scale.height;
    const crossSize = this.isPortrait ? width : height;
    const crossBase = CROSS_SPAWN_INSET + Math.random() * (crossSize - CROSS_SPAWN_INSET * 2);

    const x = this.isPortrait ? crossBase : width + SPAWN_PAD;
    const y = this.isPortrait ? -SPAWN_PAD : crossBase;

    const baseSize = 10 * enemyType.size;
    const sprite = createCachedEnemyVisual(
      this,
      x, y,
      enemyType.id,
      baseSize,
      enemyType.shape,
      toNeonPair(enemyType.color),
      RUNNER_QUALITY
    );
    sprite.setDepth(8);

    this.enemies.push({
      sprite,
      x,
      y,
      crossBase,
      radius: baseSize + 4,
      hp: enemyType.baseHealth,
      speedFactor: entry.speedFactor,
      wobbleAmplitude: entry.wobbleAmplitude,
      wobbleSpeed: entry.wobbleSpeed,
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }

  private updateEnemies(dt: number, scrollSpeed: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      const flowStep = scrollSpeed * enemy.speedFactor * dt;

      if (this.isPortrait) {
        enemy.y += flowStep;
      } else {
        enemy.x -= flowStep;
      }

      if (enemy.wobbleAmplitude > 0) {
        enemy.wobblePhase += enemy.wobbleSpeed * dt;
        const wobble = Math.sin(enemy.wobblePhase) * enemy.wobbleAmplitude;
        if (this.isPortrait) {
          enemy.x = enemy.crossBase + wobble;
        } else {
          enemy.y = enemy.crossBase + wobble;
        }
      }

      // Past the back edge → silent despawn (no score)
      const pastBackEdge = this.isPortrait
        ? enemy.y > this.scale.height + DESPAWN_PAD
        : enemy.x < -DESPAWN_PAD;
      if (pastBackEdge) {
        this.despawnEnemy(i, false);
        continue;
      }

      enemy.sprite.setPosition(enemy.x, enemy.y);

      // Enemy ↔ player collision
      if (this.invulnTimer <= 0) {
        const dx = enemy.x - this.playerX;
        const dy = enemy.y - this.playerY;
        const hitRange = enemy.radius + PLAYER_RADIUS;
        if (dx * dx + dy * dy <= hitRange * hitRange) {
          this.despawnEnemy(i, true);
          this.onPlayerHit();
          if (!this.alive) return;
        }
      }
    }
  }

  /**
   * Removes an enemy. Sprite destroy + array removal always happen together
   * (the runner-mode analog of the registerSprite/unregisterSprite pairing).
   */
  private despawnEnemy(index: number, withDeathRing: boolean): void {
    const enemy = this.enemies[index];
    if (withDeathRing) {
      this.spawnDeathRing(enemy.x, enemy.y, enemy.radius);
    }
    enemy.sprite.destroy();

    // Swap-remove keeps this O(1); iteration order does not matter.
    this.enemies[index] = this.enemies[this.enemies.length - 1];
    this.enemies.pop();
  }

  /** Cheap neon death feedback: expanding stroked ring that fades out. */
  private spawnDeathRing(x: number, y: number, radius: number): void {
    if (getSettingsManager().isReducedMotionEnabled()) return;
    const ring = this.add.circle(x, y, radius, 0x000000, 0);
    ring.setStrokeStyle(3, 0xff8866, 0.9);
    ring.setDepth(DepthLayers.SHATTER);
    this.tweens.add({
      targets: ring,
      scale: 2.4,
      alpha: 0,
      duration: 280,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private onPlayerHit(): void {
    this.playerHp--;
    this.refreshHud();

    if (this.playerHp <= 0) {
      this.onPlayerDeath();
      return;
    }

    this.invulnTimer = INVULN_SECONDS;
    this.playerShip?.setInvulnerable(true);
    this.playerShip?.playDeathFlash(160);
  }

  private onPlayerDeath(): void {
    this.alive = false;
    this.joystick?.setEnabled(false);

    const finalScore = computeScore(this.distance, this.kills);
    const isNewBest = saveRunnerBestIfHigher(finalScore);
    if (isNewBest) this.bestScore = finalScore;

    recordRunnerRun({
      timestamp: Date.now(),
      score: finalScore,
      distanceMeters: distanceToMeters(this.distance),
      kills: this.kills,
    });

    if (this.playerShip) {
      this.playerShip.playDeathFlash(300);
      const deathPos = this.playerShip.explode();
      this.spawnDeathRing(deathPos.x, deathPos.y, PLAYER_RADIUS * 2);
    }

    // Scene-scoped timer — automatically cleared if the scene shuts down first.
    this.time.delayedCall(RESULTS_DELAY_MS, () => this.showResults(finalScore, isNewBest));
  }

  // ────────────────────────────────────────────────────────────────────────
  //  HUD
  // ────────────────────────────────────────────────────────────────────────

  private createHud(): void {
    const hudScale = computeHudScale(this.scale.width, this.scale.height, getSettingsManager().getUiScale());
    const pad = scaledInt(hudScale, 14);
    const lineHeight = scaledInt(hudScale, 26);

    const makeText = (x: number, y: number, color: string, origin: number): Phaser.GameObjects.Text => {
      const text = this.add.text(x, y, '', {
        fontFamily: HUD_FONT,
        fontSize: scaledFontPx(hudScale, 18),
        color,
        stroke: '#000000',
        strokeThickness: 3,
      });
      text.setOrigin(origin, 0);
      text.setDepth(OverlayDepths.HUD);
      text.setScrollFactor(0);
      return text;
    };

    this.distanceText = makeText(pad, pad, '#88ddff', 0);
    this.scoreText = makeText(pad, pad + lineHeight, '#ffffff', 0);
    this.killsText = makeText(pad, pad + lineHeight * 2, '#ffaa66', 0);
    this.heartsText = makeText(this.scale.width - pad, pad, '#ff5566', 1);
    this.bestText = makeText(this.scale.width - pad, pad + lineHeight, '#ffdd66', 1);
  }

  private refreshHud(): void {
    this.distanceText?.setText(`${distanceToMeters(this.distance)} m`);
    this.scoreText?.setText(`SCORE ${computeScore(this.distance, this.kills)}`);
    this.killsText?.setText(`KILLS ${this.kills}`);
    this.heartsText?.setText('♥'.repeat(Math.max(0, this.playerHp)));
    this.bestText?.setText(`BEST ${this.bestScore}`);
  }

  /** Re-anchor HUD and clamp entities after a live resize (EXPAND mode). */
  private handleResize(): void {
    const hudScale = computeHudScale(this.scale.width, this.scale.height, getSettingsManager().getUiScale());
    const pad = scaledInt(hudScale, 14);
    const lineHeight = scaledInt(hudScale, 26);
    this.distanceText?.setPosition(pad, pad);
    this.scoreText?.setPosition(pad, pad + lineHeight);
    this.killsText?.setPosition(pad, pad + lineHeight * 2);
    this.heartsText?.setPosition(this.scale.width - pad, pad);
    this.bestText?.setPosition(this.scale.width - pad, pad + lineHeight);

    this.playerX = Phaser.Math.Clamp(this.playerX, EDGE_MARGIN, this.scale.width - EDGE_MARGIN);
    this.playerY = Phaser.Math.Clamp(this.playerY, EDGE_MARGIN, this.scale.height - EDGE_MARGIN);
    this.playerShip?.getContainer().setPosition(this.playerX, this.playerY);

    this.pauseOverlay?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.resultsOverlay?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.resultsDim?.setPosition(this.scale.width / 2, this.scale.height / 2);
    this.resultsDim?.setSize(this.scale.width, this.scale.height);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Pause / results / navigation
  // ────────────────────────────────────────────────────────────────────────

  private onEscKey(): void {
    if (this.resultsShown) {
      this.goToMenu();
      return;
    }
    if (!this.alive) return;
    this.togglePause();
  }

  private onRestartKey(): void {
    if (!this.resultsShown) return;
    this.restartRun();
  }

  private onMenuKey(): void {
    if (!this.resultsShown && !this.isPaused) return;
    this.goToMenu();
  }

  private togglePause(): void {
    this.isPaused = !this.isPaused;
    if (this.isPaused && !this.pauseOverlay) {
      this.pauseOverlay = this.buildPauseOverlay();
    }
    this.pauseOverlay?.setVisible(this.isPaused);
  }

  private buildPauseOverlay(): Phaser.GameObjects.Container {
    const hudScale = computeHudScale(this.scale.width, this.scale.height, getSettingsManager().getUiScale());
    const container = this.add.container(this.scale.width / 2, this.scale.height / 2);
    container.setDepth(OverlayDepths.PAUSE_MENU);

    const backdrop = this.add.rectangle(0, 0, scaledInt(hudScale, 380), scaledInt(hudScale, 130), 0x050a18, 0.85);
    backdrop.setStrokeStyle(2, 0x66bbff, 0.8);

    const title = this.add.text(0, scaledInt(hudScale, -24), 'PAUSED', {
      fontFamily: HUD_FONT,
      fontSize: scaledFontPx(hudScale, 30),
      color: '#88ddff',
    }).setOrigin(0.5);

    const hint = this.add.text(0, scaledInt(hudScale, 22), 'ESC resume   ·   M menu', {
      fontFamily: HUD_FONT,
      fontSize: scaledFontPx(hudScale, 16),
      color: '#aabbcc',
    }).setOrigin(0.5);

    container.add([backdrop, title, hint]);
    return container;
  }

  private showResults(finalScore: number, isNewBest: boolean): void {
    if (this.resultsShown) return;
    this.resultsShown = true;

    const hudScale = computeHudScale(this.scale.width, this.scale.height, getSettingsManager().getUiScale());
    const scaled = (value: number) => scaledInt(hudScale, value);

    this.resultsDim = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height,
      0x000000, 0.6
    );
    this.resultsDim.setDepth(OverlayDepths.DEATH_DARKEN);
    this.resultsDim.setScrollFactor(0);

    const container = this.add.container(this.scale.width / 2, this.scale.height / 2);
    container.setDepth(OverlayDepths.PAUSE_MENU);
    this.resultsOverlay = container;

    const panel = this.add.rectangle(0, 0, scaled(440), scaled(360), 0x050a18, 0.92);
    panel.setStrokeStyle(2, 0x66bbff, 0.9);
    container.add(panel);

    const addLine = (y: number, content: string, size: number, color: string): Phaser.GameObjects.Text => {
      const text = this.add.text(0, scaled(y), content, {
        fontFamily: HUD_FONT,
        fontSize: scaledFontPx(hudScale, size),
        color,
      }).setOrigin(0.5);
      container.add(text);
      return text;
    };

    addLine(-140, 'RUN OVER', 34, '#ff6677');
    addLine(-88, `DISTANCE   ${distanceToMeters(this.distance)} m`, 19, '#88ddff');
    addLine(-56, `KILLS      ${this.kills}`, 19, '#ffaa66');
    addLine(-16, `SCORE      ${finalScore}`, 24, '#ffffff');
    if (isNewBest) {
      addLine(20, 'NEW BEST!', 20, '#ffdd44');
    } else {
      addLine(20, `BEST       ${this.bestScore}`, 16, '#aabbcc');
    }

    container.add(this.buildOverlayButton(-105, 108, 'RESTART', hudScale, () => this.restartRun()));
    container.add(this.buildOverlayButton(105, 108, 'MENU', hudScale, () => this.goToMenu()));
    addLine(152, 'R restart · ESC menu', 13, '#667788');
  }

  private buildOverlayButton(
    x: number,
    y: number,
    label: string,
    hudScale: number,
    onActivate: () => void
  ): Phaser.GameObjects.Container {
    const buttonWidth = scaledInt(hudScale, 180);
    const buttonHeight = scaledInt(hudScale, 52);

    const button = this.add.container(scaledInt(hudScale, x), scaledInt(hudScale, y));
    const background = this.add.rectangle(0, 0, buttonWidth, buttonHeight, 0x112244, 1);
    background.setStrokeStyle(2, 0x66bbff, 1);
    const text = this.add.text(0, 0, label, {
      fontFamily: HUD_FONT,
      fontSize: scaledFontPx(hudScale, 20),
      color: '#ccecff',
    }).setOrigin(0.5);
    button.add([background, text]);

    button.setSize(buttonWidth, buttonHeight);
    button.setInteractive({ useHandCursor: true });
    button.on('pointerup', onActivate);
    addButtonInteraction(this, button);
    return button;
  }

  private restartRun(): void {
    if (this.leavingScene) return;
    this.leavingScene = true;
    this.scene.restart();
  }

  private goToMenu(): void {
    if (this.leavingScene) return;
    this.leavingScene = true;
    fadeOut(this, 200, () => this.scene.start('BootScene'));
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Shutdown
  // ────────────────────────────────────────────────────────────────────────

  shutdown(): void {
    this.scale.off('resize', this.handleResize, this);

    this.input.keyboard?.off('keydown-ESC', this.onEscKey, this);
    this.input.keyboard?.off('keydown-R', this.onRestartKey, this);
    this.input.keyboard?.off('keydown-ENTER', this.onRestartKey, this);
    this.input.keyboard?.off('keydown-SPACE', this.onRestartKey, this);
    this.input.keyboard?.off('keydown-M', this.onMenuKey, this);

    this.joystick?.destroy();
    this.joystick = null;

    this.playerShip?.destroy();
    this.playerShip = null;

    this.parallax?.destroy();
    this.parallax = null;

    // Sprite/struct pairs die together (see despawnEnemy).
    for (const enemy of this.enemies) {
      enemy.sprite.destroy();
    }
    this.enemies = [];
    for (const projectile of this.projectiles) {
      projectile.sprite.destroy();
    }
    this.projectiles = [];

    // Tweens keep running across a restart otherwise (death rings, buttons,
    // transition overlays).
    this.tweens.killAll();
  }
}
