# Top 10 Impactful Features — Implementation Plan

Session goal: design + implement 10 high-impact, *net-new* features, build-verify each,
review, then update CLAUDE.md/BACKLOG.md. Worktree: `worktree-top10-features`.

## Selection method
Two scout passes mapped gameplay/meta and UX/feel. Then verified against real code to
avoid rebuilding existing work. **Already present (excluded):** per-weapon damage
attribution + run-summary breakdown, hit-stop on crits/kills, low-HP danger vignette,
combo-tier juice (shake/flash/stinger/particles), off-screen indicators, rich game-over
stats. **Dropped:** dynamic music (MusicManager has no playback-rate; mid-run `.mod`
swap is janky, no boss tracks) — low payoff, high risk.

Genuinely-missing, high-impact, contained features below. Verification = `npm run build`
(tsc + vite) clean after each, plus reasoning (no test framework exists).

---

### 1. Active Ultimate Ability — "Overdrive"  *(biggest gameplay gap: player abilities ★1/5)*
A charge meter that fills from kills/damage; a dedicated key (Q / gamepad Y / touch
button) unleashes a screen-clearing nova scaling with player damage + brief slow-time.
- **New:** `src/systems/UltimateSystem.ts` (module-level charge state, `reset*`).
- HUD charge arc/bar (HUDManager). Input hook (InputController emits `input-ultimate-requested`).
- GameScene wires fill (onEnemyKilled/onEnemyDamaged) + trigger (nova damage via WeaponManager
  AOE, screen flash, slow-time, sound). Save/restore charge in GameStateManager.
- Touch button (TouchActionButtons) + first-run tutorial hint.
- **Files:** new system; InputController, HUDManager, TouchActionButtons, GameScene, GameStateManager, SoundManager.

### 2. Upgrade Rarity Tiers  *(every level-up flat → exciting)*
Common/Rare/Epic/Legendary tiers on level-up cards. Tier rolled per-card (luck-weighted),
scales the upgrade's effect magnitude, distinct card visuals (border/gem/glow) + reroll keeps rarity feel.
- **New:** `src/data/UpgradeRarity.ts` (tiers, weights, magnitude multipliers, luck stat).
- Upgrades.ts: per-upgrade rarity eligibility + magnitude-aware apply. UpgradeScene: card visuals + roll.
- GameScene: pass luck stat; apply tier multiplier when applying upgrade.
- **Files:** new data; Upgrades.ts, UpgradeScene.ts, GameScene.ts.

### 3. Elite Enemy Affixes  *(RoR2-style variety + risk-reward)*
Random non-boss enemies spawn with an affix (Blazing/Frozen/Volatile/Vampiric/Swift/Armored).
Aura visual, modified stat/behavior, bonus gold+XP+relic-chance on kill. Scales with world level/time.
- **New:** `src/enemies/EnemyAffixes.ts` (defs, roll table, apply-to-stats), `EnemyAffix` component field.
- EnemyAISystem/spawn path applies affix; EnemyVisuals draws aura; WeaponManager death rewards.
- **Files:** new data; components, spawn glue in GameScene/DirectorSystem, EnemyVisuals, WeaponManager/GameScene death handler.

### 4. Danger-Zone Telegraph System  *(fairness/tactical readability)*
Reusable growing red AOE warning before heavy attacks (giant/charger slam, exploder detonation,
boss AOE). Generalizes ad-hoc shake telegraphs into readable spatial zones.
- **New:** `src/visual/DangerZoneManager.ts` (pooled zone graphics, `telegraph(x,y,r,ms)`, `reset`).
- Hook existing slam/explode windups in EnemyAISystem + GameScene callbacks.
- **Files:** new manager; EnemyAISystem, GameScene. Quality + reduced-motion aware.

### 5. Tactical Minimap / Threat Radar  *(awareness gap)*
Corner radar: enemy-density blips, boss/miniboss markers, pickups, player center. Toggleable; scales with HUD.
- **New:** `src/visual/MinimapManager.ts` (RenderTexture/graphics, pooled blips).
- HUD layer placement; GameScene per-frame feed (SpatialHash + boss list). Settings toggle.
- **Files:** new manager; GameScene, HUDManager/DepthLayers, SettingsManager/SettingsScene.

### 6. First-Run Contextual Tutorial Hints  *(onboarding near-absent; `tutorialSeen` flag unused)*
One-time contextual toasts gated by persistent flags: move, first level-up (explain upgrades),
first dash, ultimate-ready, combo, first miniboss, evolution-ready. Dismissible; never repeats.
- **New:** `src/systems/TutorialHintManager.ts` (per-hint seen flags via SecureStorage, `reset` for run).
- Hook GameScene events; reuse ToastManager. Wire existing `tutorialSeen`.
- **Files:** new manager; GameScene, SettingsManager (per-hint keys).

### 7. Accessibility Pack  *(no colorblind; shake is on/off only)*
Colorblind palettes (off/protanopia/deuteranopia/tritanopia) remapping key gameplay colors
(enemy/projectile/status/damage-number/affix/danger-zone); screen-shake **intensity** slider
(replace bool); high-contrast HUD toggle; ensure reducedMotion respected.
- **New:** `src/visual/ColorblindPalette.ts` (mode + transform fn used app-wide).
- SettingsManager: shakeIntensity (0–1), colorblindMode, highContrast. SettingsScene UI.
- JuiceManager.screenShake scales by intensity. NeonColors/EnemyVisuals route through palette.
- **Files:** new util; SettingsManager, SettingsScene, JuiceManager, NeonColors/visual consumers.

### 8. Daily Quests / Bounty System  *(daily-return retention)*
3 rotating daily objectives (kill N, reach level L, defeat a boss, land N crits, survive T)
with gold rewards, tracked across runs, surfaced on BootScene + post-run claim.
- **New:** `src/meta/BountyManager.ts` (date-seeded pick, progress, claim, SecureStorage), `src/data/Bounties.ts`.
- Feed run-end stats; BootScene panel + post-run toast/claim.
- **Files:** new manager + data; GameScene (record), BootScene (panel).

### 9. Cursed Shrine Event  *(risk-reward economy/decision)*
New EventSystem event: a shrine pickup spawns; touching it applies a temporary curse
(tougher/faster enemies) for a window in exchange for a guaranteed relic + gold burst.
- Extend `EventSystem.ts` with `cursed_shrine`; spawn shrine entity; GameScene collision → curse + reward.
- **Files:** EventSystem.ts, GameScene (shrine entity + pickup), RelicManager hook.

### 10. In-Run Stats Dashboard (pause)  *(no live in-run analytics)*
Pause-menu live run panel: DPS, total damage, crit%, kills/min, damage taken, top weapons
(reuses `getWeaponRunStats`). Toggle tab in pause overlay.
- **Files:** PauseMenuManager.ts (new panel), GameScene (feed live stats to pause payload).

---

## Execution order (foundation-first, minimize conflict)
1 Accessibility (palette+settings foundation) → 2 Ultimate → 3 Rarity → 4 Affixes →
5 Danger Zones → 6 Minimap → 7 Tutorial → 8 Bounties → 9 Shrine → 10 Stats Dashboard.

Commit per feature. `npm run build` after each. Then: review agents (code-reviewer + ux-reviewer),
fix findings, update CLAUDE.md (revise-claude-md skill) + BACKLOG.md changelog.

## Conventions to honor (from CLAUDE.md)
- Module-level systems need `reset*System()` called in GameScene `create()`.
- Register `shutdown` listeners; `unregisterSprite` before `removeEntity`; pool frequent objects.
- Persistent data via SecureStorage only. Descriptive variable names. Delta ms → ×0.001 for seconds.
