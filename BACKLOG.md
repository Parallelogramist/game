# BACKLOG

Single source of truth for deferred work, known issues, and improvement ideas.
Fleet agents: pick the **topmost unchecked item you can finish in one session**
(Now → Next → Later), build it **test-first**, check it off with the commit hash,
append any follow-ups you discover, commit. The human reprioritizes freely.

## How this system works

- Every item has a stable **ID**, a one-line **value** rationale, and **pointers**
  (files / line hints) so any session can pick it up cold.
- `- [ ]` = open, `- [x]` = done. When you finish, check it off with
  `(done — <hash>)` and move it to `BACKLOG-archive.md` (full write-ups live there).
- New ideas/cuts discovered mid-task get appended immediately (Next or Later), so
  nothing lives only in conversation.
- **Never agent work:** anything under **## Human gates** — pushing, deploys,
  publishing, spend, and anything needing a human playing in a browser.
- ID prefixes: `FEAT-` (new), `TEST-` (coverage), `REFACTOR-`, `BALANCE-`/`POLISH-`
  (tuning/feel), `BUG-`, `CHORE-`.

> **Env note for fleet agents:** `npm run test`, `npx tsc --noEmit`, and
> `npm run build` all run to completion in recent bg sessions (full suite ~473 green in
> <1s). If a session hits a *total* bash hang (even `echo` never returns), don't burn the
> session retrying — a fresh agent clears it. Never `pkill -f vitest` broadly (other fleet
> agents share this host); kill only your own PID. This checkout has a local, gitignored
> `.claude/settings.json` with `{"worktree":{"bgIsolation":"none"}}` so bg edits land on
> `master` (re-create it if the fleet ever runs from a fresh clone).

---

## Now

(empty — next agent: take the topmost Next item)

## Proposed (auto)

- [x] **FEAT-WEAPON-SCATTER** — new 25th weapon, Scattergun (done — ae3b27a).
  The arsenal's first *directional multi-pellet spread burst*. Each cooldown it
  aims at the nearest live enemy and fires a tight fan of instant hitscan pellet-
  rays across a spread arc — a short-reach, wide-cone crowd shredder that overlaps
  a single enemy at point-blank and melts it, falling off with distance. Distinct
  from all 24 peers: Projectile is one auto-aim long shot, Shuriken a spiral in
  every direction, Flamethrower a continuous DoT cone, Pulse/Storm/Sweep area or
  global — none fires a discrete directional pellet fan. Instant hit (no traveling
  projectile), self-drawn pooled Graphics (no atlas frame), per-pellet line hit-test
  mirroring Railgun's — no core combat/damage/projectile pipeline change. Wired into
  `WeaponRegistry`, `UNLOCKABLE_WEAPONS`, `ICON_MAP` (`pistol-gun`),
  `WEAPON_MASTERY_CATEGORY` (projectile), a "Devastator" evolution (multishot Lv5)
  and a "Cold Snap" synergy (+ Frost Nova). Mastery "Point Blank" amplifies
  close-range hits. Playtest follow-up filed as **POLISH-WEAPON-SCATTER** under
  `## Human gates`.
- [x] **FEAT-BOSS-OBELISK** — new 7th boss, The Obelisk (done — dac5386). A
  looming green energy monolith whose signature is *marching walls* of
  telegraphed ground strikes: a full-arena line of large overlapping blasts with
  a single threadable safe lane, doubled into offset rows whose gaps shift so the
  player threads one lane then slides to the next as the rows land in sequence —
  the game's first advancing-wall / lateral "run to the gap" bullet-hell rhythm.
  The boss pool was 6 bosses cycling every ~6 runs; a 7th cuts the most-repeated
  content and is felt every run. Distinct from all 6 existing bosses (slam /
  serpentine / laser-cross / mortar / split / rotating-spokes): the only iconic
  bullet-hell signature none of them provide, and — unlike Pulsar's boss-relative
  spokes — its walls are ARENA-relative, so the boss looms at centre while walls
  sweep the whole field. Orientation (horizontal/vertical) and gap rotate every
  barrage; phases escalate rows (2→2→3), tighten cadence (3.0/2.7/2.4s), and raise
  damage (23/28/33). Pure, deterministic, unit-tested wall
  planner (`obelisk-barrage.ts`) feeds a Pulsar-style two-state AI (`obelisk.ts`);
  all damage is telegraphed ground strikes via the existing `groundSlamCallback`
  — no core combat/damage/projectile pipeline change. Wired into
  `TUNING.bosses.order` (auto-joins practice + gauntlet + boss cycling + Codex
  bestiary), a bespoke `EnemyVisuals` drawer, a green boss-arena theme,
  boss-phase hazards, `ENEMY_ARMOR`, and a "Wallbreaker" defeat achievement.
  Playtest follow-up filed as **POLISH-BOSS-OBELISK** under `## Human gates`.
- [x] **FEAT-MINIBOSS-BOMBARD** — new 7th miniboss, The Bombard (done — b89267f). A
  hovering siege platform that kites the player at long range and drops telegraphed
  AOE mortar clusters (center + satellite ring) on the player's position, forcing
  constant repositioning — the arsenal's first area-denial/artillery miniboss.
  The 6 existing minibosses fill: consumer (Glutton), summoners (Swarm Mother,
  Necromancer), rusher (Charger), paired setpiece (Twins) — none keeps distance and
  zones the ground you stand on. All damage routes through the existing
  `groundSlamCallback` (telegraphed ground strikes) — no core combat/damage/
  projectile pipeline change. Pure, unit-tested salvo planner (`bombard-barrage.ts`)
  feeds a Pulsar-style two-state AI (`bombard.ts`). Wired into
  `TUNING.minibosses.schedule` as a 6th schedule slot (auto-joins Practice mode,
  Gauntlet, and the Codex bestiary — all three derive from `ENEMY_TYPES` /
  the schedule array), the endless miniboss pool, and a bespoke `EnemyVisuals`
  drawer. Playtest follow-up filed as **POLISH-MINIBOSS-BOMBARD** under
  `## Human gates`.
- [x] **FEAT-BOSS-PULSAR** — new 6th boss, The Pulsar (done — 11c5ab5). A
  collapsed-star boss whose threat is a rotating field of telegraphed energy
  strikes emanating from itself (radial spoke waves), escalating to a
  converging-ring "collapse" barrage with a rotating escape lane in phase 2+ —
  the game's first shrinking-safe-zone mechanic. The boss pool was 5 fixed
  bosses (`horde_king, void_wyrm, the_machine, the_bastion, the_legion`),
  repeated every ~5 runs; a 6th boss cuts the most-repeated content and is felt
  every run. Distinct from all 5 existing bosses (slam / serpentine /
  laser-grid / mortar / split) — the first "spatial rhythm" boss whose danger
  originates from the boss in a rotating radial geometry the player orbits and
  threads. Pure, deterministic barrage planners (`pulsar-barrage.ts`,
  unit-tested) feed a Bastion-style AI state machine (`pulsar.ts`); all damage
  is telegraphed ground strikes via the existing `groundSlamCallback` — no core
  combat/damage/projectile pipeline change. Wired into `TUNING.bosses.order`
  (auto-joins practice + gauntlet), a bespoke `EnemyVisuals` drawer, a boss
  arena theme, boss-phase hazards, `ENEMY_ARMOR`, and a "Star Killer" defeat
  achievement. Playtest follow-up filed as **POLISH-BOSS-PULSAR** under
  `## Human gates`.
- [x] **FEAT-WEAPON-RAILGUN** — new 24th weapon, Railgun (done — 142154d). Each
  cooldown it locks the single toughest enemy on the field (highest current HP) and fires
  an instant piercing rail lance from the ship through it, dealing heavy single-target
  damage and skewering a limited number of enemies along the line — the arsenal's first
  *toughest-target single-strike* and its first dedicated anti-boss/anti-elite focus tool.
  Every other weapon is crowd-clear, nearest-target, random, zone, or companion; none
  prioritized the toughest enemy. Distinct from Laser Beam (cursor-aimed continuous beam)
  by auto-targeting the highest-HP enemy and firing a discrete burst on cooldown.
  Self-drawn hot-cyan lance Graphics (no atlas frame), pooled lances; wired into
  `WeaponRegistry`, `UNLOCKABLE_WEAPONS`, `ICON_MAP` (`telescope`),
  `WEAPON_MASTERY_CATEGORY` (beam), an "Annihilator" evolution (piercing Lv5) and a "Siege
  Protocol" synergy (+ singularity). Mastery "Killshot" doubles damage to the locked
  target. Playtest follow-up filed as **POLISH-WEAPON-RAILGUN** under `## Human gates`.
- [x] **FEAT-WEAPON-STORM** — new 23rd weapon, Storm Caller (done — b713251). Every
  cooldown it calls down lightning bolts that strike random enemies ANYWHERE on the
  field, each zapping a small AOE — the arsenal's first *global random-strike*. Every
  other weapon is player-centric (aura/pulse/sweep/mines/orbits/wake originate at the
  ship) or aim/nearest-centric (projectile/laser/homing/chain/katana); Meteor — the
  only other sky-strike — targets dense clusters within player range after a 0.8s
  telegraph. Storm hits instantly, fast cadence, small per-bolt splash + electric
  stun, reaching the scattered stragglers player-centric AOE leaves alive. Self-drawn
  jagged-bolt Graphics (no atlas frame), pooled strikes; wired into `WeaponRegistry`,
  `UNLOCKABLE_WEAPONS`, `ICON_MAP` (`lightning-frequency`), `WEAPON_MASTERY_CATEGORY`
  (explosive), a "Maelstrom" evolution (multishot Lv5) and an "Overcharge" synergy
  (+ chain lightning). Mastery "Thunderclap" stuns struck enemies. Playtest follow-up
  filed as **POLISH-WEAPON-STORM** under `## Human gates`.
- [x] **FEAT-WEAPON-SWEEP** — new 22nd weapon, Arc Sweep (done — 2fbabcb). A continuous
  beam anchored at the ship that rotates 360° around the player, ticking damage into every
  enemy its line crosses — the arsenal's first *rotating line*: laser is a cursor-aimed
  burst, aura a full zone, orbiting blades discrete points, pulse expanding rings. Aim-free
  coverage that scales with spoke count. Self-drawn Graphics (no atlas frame), per-enemy
  `HitCooldownTracker` throttling (Aura idiom), pure unit-tested beam geometry
  (`sweepBeamLogic.ts`); wired into `WeaponRegistry`, `UNLOCKABLE_WEAPONS`, `ICON_MAP`
  (`sunbeams`), `WEAPON_MASTERY_CATEGORY` (beam), a "Corona" evolution (haste Lv5) and a
  "Gyre" synergy (+ orbiting blades). Mastery "Solar Flare" adds a spoke and widens the
  sweep. Playtest follow-up filed as **POLISH-WEAPON-SWEEP** under `## Human gates`.

- [x] **FEAT-WEAPON-MINE** — new 21st weapon, Proximity Mines (done — 470a319). Each
  cooldown places stationary mines at and around the ship; a mine arms after a short
  delay, then detonates in an AOE burst — damaging + knocking back every enemy in the
  blast, once — the moment an enemy strays into its trigger radius, or auto-detonates
  at end of life. The arsenal's first area-denial trap archetype: Sentry deploys a
  turret that shoots, Wake lays a DoT trail, Pulse emits rings from the player — none
  is a placed proximity mine. Self-drawn Graphics (no atlas frame), pooled mines;
  wired into `WeaponRegistry`, `UNLOCKABLE_WEAPONS`, `ICON_MAP` (`death-zone`),
  `WEAPON_MASTERY_CATEGORY` (explosive), a "Cluster Mines" evolution (might Lv5) and a
  "Kill Zone" synergy (+ singularity). Mastery "Minefield" lays one extra mine per
  deployment. Playtest follow-up filed as **POLISH-WEAPON-MINE** under `## Human gates`.

- [x] **FEAT-WEAPON-PULSE** — new 20th weapon, the Pulse Cannon (done — 8e0f453).
  Fires concentric expanding shockwave rings that damage + knock back every enemy their
  wavefront sweeps over, once each, then die at max range — a rhythmic, aim-free
  crowd-clear archetype none of the other 19 weapons had. Self-drawn Graphics (no atlas
  frame), pooled rings; wired into `WeaponRegistry`, `UNLOCKABLE_WEAPONS`, `ICON_MAP`
  (`radar-sweep`), `WEAPON_MASTERY_CATEGORY` (aura), a "Resonance Cascade" evolution
  (multishot Lv5) and a "Resonance Field" synergy (+ aura). Mastery "Concussion Wave"
  briefly stuns struck enemies. Full write-up in `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-WEAPON-PULSE** under `## Human gates`.

- [x] **FEAT-SHIP-PAINT** — the 13 hidden `cosmetic` unlocks now actually recolor your
  ship (done — 0135f52). Every `target:'cosmetic'` HiddenUnlock (`cosmetic_gold_hull`,
  `cosmetic_inferno_trail`, `cosmetic_crit_aura`, `cosmetic_level_crown`, …) fired an
  unlock toast but **nothing consumed its id** — a whole phantom-reward category. Each
  now maps to a distinct hull **paint** (`src/data/ShipPaints.ts`); a pure, unit-tested
  `resolveEquippedPaint()` picks the highest-rank *unlocked* paint and
  `GameScene.getShipNeonColor()` returns it instead of the ship palette, so the hull,
  glow, engine accents and motion trail recolor through the game's single ship-color
  hook. Strictly additive (zero unlocks → unchanged), no new storage key, no new scene/
  Codex tab. Full write-up in `BACKLOG-archive.md`. Follow-ups: **FEAT-SHIP-PAINT-PICKER**
  (below) and **POLISH-SHIP-PAINT** (under `## Human gates`).

- [x] **FEAT-SHIP-CHASE** — surface the locked ships and how to unlock them
  (done — f1000e7). The game ships **11 ships** (`src/data/ShipCharacters.ts`) — each a
  distinct playstyle (six stat multipliers, a unique hull, a signature ultimate, signature
  bonuses) — but only **3 are unlocked by default** (Sparrow, Interceptor, Dreadnought) and
  `WeaponSelectScene.renderShipSelectionStep()` rendered **only unlocked** ships
  (`getAvailableShips()`), so from the menu a player never saw the other **8 hidden-gated
  ships** or how to earn them — the whole ship roster and its unlock chase were invisible,
  the same hole FEAT-STAGE-CHASE (`6158650`) fixed for biomes and FEAT-ASCEND-CHASE
  (`88c0cc3`) for prestige. The ship step now renders the locked ships as dim,
  non-selectable cards showing the ship name, a gold "LOCKED" tag, the kit description, and
  the unlock hint (`hidden:` → the HiddenUnlocks `hintText`; `worldLevel:`/`account:` →
  "Reach world/account level N"). Isolated to `WeaponSelectScene` — **no data change, no new
  module, no `ShipCharacters`/`HiddenUnlocks`/`UnlockGates` edit, no persistence**; locked
  cards use `interactive: false` and are excluded from the `MenuNavigator`, so keyboard/pad
  nav still lands only on unlocked ships. Direct twin of FEAT-STAGE-CHASE in the same scene:
  reuses `getLockedStages`/`describeStageUnlock`/`renderLockedStageCard` as
  `getLockedShips`/`describeShipUnlock`/`renderLockedShipCard`. Full write-up in
  `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-SHIP-CHASE** under
  `## Human gates`.
- [x] **FEAT-STAGE-CHASE** — surface the locked biomes and how to unlock them
  (done — 6158650). The game ships **4 stages/biomes** (`src/data/Stages.ts`: Deep Void,
  Inferno, Crystal Caves, Endless Void) — each with a distinct palette and its own risk/reward
  multipliers — but `WeaponSelectScene.getAvailableStages()` filtered the stage-select step to
  **only unlocked** stages, and the step was **auto-skipped entirely** whenever ≤1 stage was
  unlocked. So on a fresh profile (only Deep Void unlocked) the player never saw the stage step
  at all, and even later never saw the 3 locked biomes or how to earn them — the whole biome
  roster and its unlock chase were invisible, the same invisible-chase hole FEAT-ASCEND-CHASE
  (`88c0cc3`) fixed for prestige. The stage step now always appears and renders the locked biomes
  as dim, non-selectable cards showing the biome name, a gold "LOCKED" tag, the modifier
  description, and the unlock hint (`hidden:` → the HiddenUnlocks `hintText`;
  `worldLevel:`/`account:` → "Reach world/account level N"). Isolated to `WeaponSelectScene` —
  **no data change, no new module, no `Stages`/`HiddenUnlocks`/`UnlockGates` edit, no
  persistence**; locked cards use `interactive: false` and are excluded from the `MenuNavigator`,
  so keyboard/pad nav still lands only on selectable biomes. Full write-up in
  `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-STAGE-CHASE** under `## Human gates`.
- [x] **FEAT-CODEX-EVOLUTIONS** — surface the hidden weapon-evolution recipes as a browsable
  Codex tab (done — d4099c5). The game ships **19 weapon evolutions**
  (`src/data/WeaponEvolutions.ts`): each weapon evolves into a named super-form when it reaches
  weapon-level 5 **and** a specific stat reaches level 5, and `WeaponManager.evolve()` applies
  it live — the biggest power spike in a run. But that recipe was surfaced **only in-run** (the
  `UpgradeScene` level-up modal, and only for the weapon it happens to offer; the in-run HUD;
  a tutorial hint), so from the menu a player had **no way to see or plan** an evolution build:
  you could not learn that Katana + Swiftness Lv5 → Blade Dancer without stumbling into it
  mid-run. Added a seventh Codex tab, **Evolutions**, listing all 19 as always-visible cards
  (base-weapon icon, the evolved form's name, the recipe `<Weapon> Lv5 + <Stat> Lv5`, the
  formatted power gain, and the flavor description), turning the genre's deepest hidden build
  mechanic into a browsable reference. Directly mirrors the just-shipped **FEAT-CODEX-RELICS**
  (`759a1cd`) / **FEAT-CODEX-SYNERGIES** (`37a45d3`) architecture: reuses `layoutCardGrid`;
  static reference — **no discovery-tracking, no `CodexState`/persistence change, no
  completion-% impact** (completion weights only weapons + enemies). Chosen as an always-visible
  tab over enriching the discovery-gated Weapons cards so undrawn weapons' recipes are visible
  too. Card border stays `0x4a4a7a` so `updateFocusVisuals` needs no change. Full write-up in
  `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-CODEX-EVOLUTIONS** under
  `## Human gates`.
- [x] **FEAT-CODEX-RELICS** — surface the hidden relic pool as a browsable Codex tab
  (done — 759a1cd). The game ships **28 relics** (`src/data/Relics.ts`) that
  `RelicManager` drops from chests / minibosses / events and applies as real `PlayerStats`
  modifiers, but the only surfaces that ever named a relic — the pickup path and the in-run
  relic strip HUD — require you to have **already** picked it up, so there was **no way to
  see the pool**: a player could not learn that (e.g.) Harbinger Mount grants +1 weapon slot
  without blind-drawing it. Added a sixth Codex tab, **Relics**, listing all 28 as
  always-visible cards (relic icon + rarity label both tinted the rarity colour —
  common/rare/epic/legendary — plus the effect description), turning an invisible 28-item
  collection into a browsable reference. Directly mirrors the just-shipped
  **FEAT-CODEX-SYNERGIES** (`37a45d3`) architecture: reuses `layoutCardGrid`; static
  reference — **no discovery-tracking, no `CodexState`/persistence change, no completion-%
  impact** (completion weights only weapons + enemies). Card border stays `0x4a4a7a` so
  `updateFocusVisuals` needs no change. Full write-up in `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-CODEX-RELICS** under `## Human gates`.
- [x] **FEAT-CODEX-SYNERGIES** — surface the hidden weapon-synergy system as a browsable
  Codex tab (done — 37a45d3). The game ships 15 passive weapon-pair synergies
  (`src/data/WeaponSynergies.ts`) that `WeaponManager` applies as real per-weapon damage +
  cooldown multipliers, but the only surfaces that ever named them
  (`GameScene.showSynergyToast`, and the pause dashboard's `activeSynergies` list) both
  require you to have **already** equipped a triggering pair — there was **no way to see
  the possible pairs**, so with 15 real pairs out of C(19,2)=171 the blind-discovery rate
  was ~9%. Added a fifth Codex tab, **Synergies**, listing all 15 as always-visible cards
  (both weapons + icons, the mechanical `+X% dmg`/`+Y% atk spd` bonus, and the flavor
  description), turning a "just experiment" system into a build axis you can plan toward.
  Reuses the Codex's own `layoutCardGrid` architecture; the tab is a static reference —
  **no discovery-tracking, no `CodexState`/persistence change, no completion-% impact**
  (completion weights only weapons + enemies). Base table values shown (the Codex opens
  from the menu, outside a run). Full write-up in `BACKLOG-archive.md`. Playtest follow-up
  filed as **POLISH-CODEX-SYNERGIES** under `## Human gates`.
- [x] **BUG-META-BARRIER-CAPACITY-DEAD** — the 2,968-gold shop upgrade that bought
  nothing (done — 1e7ef6c). `barrierCapacityLevel` ("+N max shield charges",
  maxLevel 4, 250→1458g) added to `PlayerStats.maxShieldCharges`, but every reader of a
  charge — recharge, the block in `takeDamage`, the HUD — is gated on
  `shieldBarrierEnabled`, which **only** the `rare` in-run `shieldBarrier` upgrade ever
  set. So the whole purchase was inert unless you won an RNG roll mid-run; the code's own
  comment at `GameScene.ts:9105` admitted it and hid the HUD rather than fix it. And when
  you did win the roll, `Math.max` in `apply()` clamped the total to the level's own
  count, so from `shieldBarrier` level 8 up the paid charges contributed **zero**. Buying
  capacity now enables and fills the barrier at run start (recharge stays at the 8.0s
  default = level 1; the in-run upgrade still sells the speed), and `apply()` is additive.
  Last member of the dead-field class after BUG-META-DEAD-RESOURCES (`1443893`),
  BUG-VITALITY-HEAL-DEAD (`9b520d0`) and BUG-RUNSTART-HP-CAP (`8184fac`) — the planner
  re-audited every `PlayerStats` field and every `getStarting*` getter and found no others
  left. Full write-up in `BACKLOG-archive.md`. **No playtest filed** — see the write-up
  for why, and for the difficulty knob this opens.
- [x] **FEAT-ASCEND-CHASE** — the prestige system you can't see until you're already
  standing on it (done — 88c0cc3). `ShopScene` rendered nothing about ascension unless
  `canAscend` was already true, and `getAscensionThreshold()` — the account level the
  player needs — had zero callers in `src`. Worse, the top upgrade unlock tier (50) sits
  below every ascension threshold (50 + 15·level), so from the second ascension on the
  ACCOUNT LV chip read "ALL UNLOCKED" with a full gold bar while the player was 15 levels
  short. The chip now chases the next real milestone (unlock tier → ascension → truly
  complete) via a pure, tested resolver, a hint line names the threshold and the payoff
  from account level 0, and the ASCEND button no longer needs a shop re-entry to appear.
  Full write-up in `BACKLOG-archive.md`. Playtest follow-up filed as
  **POLISH-ASCEND-CHASE** under `## Human gates`.
- [x] **BUG-JUICE-SLOWMO-DEAD** — every cinematic slow-motion was cancelled by the hit
  stop fired the line before it (done — b7a5e47). `JuiceManager.slowMotion()` opened with
  `if (!this.scene || this.slowMotionActive || this.hitStopActive) return;`, and
  `hitStop()` sets `hitStopActive` **synchronously** while clearing it only from a
  `delayedCall` — so every callsite that fires the pair in one synchronous call had its
  slow-mo silently dropped. That is **4 of the 7 callsites, unconditionally**: boss kill
  and miniboss kill (`WeaponManager.ts:631/633` hit-stop on the same `xpValue` thresholds
  that gate the slow-mo in `handleEnemyDeath`, invoked on the next line via
  `onEnemyKilled`), the boss phase transition (`GameScene.ts:7881-7882`, adjacent lines),
  and the combo annihilation (`:6821`/`:6831`). The BOMB consumable and every ship
  ultimate call `detonateArea()` first, so a crit or a big kill in their own blast
  suppressed their cinematic too — including all 11 hand-tuned `slowMo` entries in
  `ShipUltimates.ts`. Only `playDeathSequence` ever played, because its author
  hand-staggered it (`t=0` hitStop 120ms, `t=150` slowMotion). `JuiceManager` now performs
  that handoff itself — a slow-mo requested during a freeze is chained, not dropped — and
  scene-bound state is released on every (un)bind so `hitStopActive` can no longer latch
  true and mute hit stop **and** slow motion for the whole page session. `resetJuiceManager()`
  (zero callers, the last dead reset export) is now wired into `resetAllRunSystems()`.
  **No balance number changes** — every duration and scale already existed in the code and
  slow-mo is visual-only (no physics body exists in the game). Full write-up in
  `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-JUICE-SLOWMO** under
  `## Human gates`.
- [x] **FEAT-SHIP-ULTIMATES** — every ship gets its own ultimate (done — 49c934f).
  Value: the ultimate is the game's biggest button and was identical on all 11 ships
  while every other ship axis (hull, palette, six stat multipliers, signature stat
  bonuses) already differed. Full write-up in `BACKLOG-archive.md`. Playtest follow-up
  filed as **BALANCE-SHIP-ULTIMATES** under `## Human gates`.
- [x] **FEAT-PRACTICE-ULT** — fire any ship's ultimate on demand from the practice
  dock (done — 9288a23). The sandbox can now select any of the 11 ultimates and fire
  them instantly; it was previously locked to Overdrive because `PracticeScene`
  starts `ship_default`. The dock gained a fit-to-height shrink because 10 rows
  overflow a phone's 720-unit canvas. Full write-up in `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-PRACTICE-ULT** under `## Human gates`.
- [x] **FEAT-PRACTICE-BUILD** — fight a boss with the build you'd really have
  (done — 41df31c). Value: closes the documented level-0-passives limit that
  blocks the absolute "siege or drag" reads in POLISH-BOSS-AFFIXES (c),
  POLISH-MINIBOSS-AFFIXES (c), POLISH-AFFIX-PARAGON (c), POLISH-BOSS-LEGION (e)
  and POLISH-ENDLESS-MUTATORS (g). Full write-up in `BACKLOG-archive.md`.
  Playtest follow-up filed as **POLISH-PRACTICE-BUILD** under `## Human gates`.
- [x] **FEAT-PRACTICE-TIME** — set the arena's clock, cycle, and mutator on
  demand (done — 8452234). Shipped as two rows (ARENA + MUTATOR), not one:
  mutators are RNG-rolled, so a clock alone could never reach the *named*
  mutators its own rationale asks about. Full write-up moved to
  `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-PRACTICE-TIME**
  under `## Human gates`.
- [x] **BUG-META-DEAD-RESOURCES** — three shop upgrades took gold and did
  nothing (done — 1443893). Fortune (`dropRateLevel`), Scavenger
  (`healthDropLevel`) and Boss Slayer (`bossGoldLevel`) each multiplied a
  `PlayerStats` field that nothing in the codebase read — ~13,500 gold of
  placebo in the one shop category you buy to earn more. Same dead-field class
  as BUG-VITALITY-HEAL-DEAD (`9b520d0`), found by auditing every `PlayerStats`
  field and every `getStarting*` getter for a reader. Full write-up moved to
  `BACKLOG-archive.md`. **No playtest filed** — see the write-up for why, and
  for the Boss Slayer price/payoff knob.
- [x] **BUG-RUNSTART-HP-CAP** — every run started at 100 HP no matter your max
  (done — 8184fac). `createPlayer` seeded the ECS Health component with a
  hardcoded `100/100`, and `syncStatsToPlayer` only ever clamps current HP
  *downward* — correct mid-run, but at run start it clamps against the
  placeholder, so 100 became a hard cap on starting HP. Every profile past
  ~1,992-gold Fortitude 4 (or Fortitude 1 on the Juggernaut) began each run
  short; a maxed Fortitude Juggernaut started **100/289**, missing 65% of the
  health it paid for. Silently taxed Fortitude, every ship healthMultiplier,
  ship mods, achievement HP, cards, boosts and last session's `blessed_vigor`
  (+25% max HP, `48400ec`). Same dead-value class as BUG-VITALITY-HEAL-DEAD
  (`9b520d0`) — which diagnosed this exact clamp but only fixed the *mid-run*
  half. Full write-up moved to `BACKLOG-archive.md`. **No playtest filed** —
  see the write-up for why, and for the difficulty knob this opens.

## Next

*(groomed 2026-07-16 — roadmap pass; ordered by value)*

- [x] **FEAT-PRACTICE-MODE** — reach any weapon at any level without grinding a
  run (done — c3d00c2). Full write-up moved to `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-PRACTICE-MODE** under `## Human gates`.

- [x] **FEAT-PRACTICE-BOSS** — practice v2: spawn any boss/miniboss with any
  affix, on demand (done — 43a76b7). Full write-up moved to `BACKLOG-archive.md`.
  Playtest follow-up filed as **POLISH-PRACTICE-BOSS** under `## Human gates`.

- [x] **FEAT-SAVE-EXPORT** — profile backup: export/import the whole
  meta-progression (done — a876ed0). Full write-up moved to
  `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-SAVE-EXPORT**
  under `## Human gates`.

- [x] **FEAT-ENDLESS-BEST-CYCLE** — persistent deepest-endless-cycle chase
  metric (done — 809f7cf). Full write-up moved to `BACKLOG-archive.md`.
  Playtest follow-up filed as **POLISH-ENDLESS-BEST-CYCLE** under
  `## Human gates`.

- [x] **FEAT-ACHIEVE-ENDGAME** — achievement coverage for the endgame that
  exists (done — 5e2770d). Full write-up moved to `BACKLOG-archive.md`.
  Playtest follow-up filed as **POLISH-ACHIEVE-ENDGAME** under
  `## Human gates`.

- [x] **FEAT-SAVE-EXPORT-REMINDER** — nudge long-lived profiles to back up
  (done — da469b7). Full write-up moved to `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-SAVE-EXPORT-REMINDER** under `## Human gates`.

- [x] **FEAT-META-MEMORY** — implement Memory (`upgradeKeepLevel`) (done —
  f3ba7ce). The last paid dead getter in the shop: a 2,000-gold upgrade whose
  card promised "Keep {level} lowest upgrades" while `getStartingUpgradeKeep()` had
  zero callers. Both run-end paths now bank the run's build, and the next run
  re-applies its N lowest. Full write-up moved to `BACKLOG-archive.md`. **No playtest
  filed** — see the write-up for why, and for the carryover-magnitude and
  daily-fairness knobs.
- [x] **FEAT-META-BLESSING** — implement Blessing (`blessingLevel`) (done —
  48400ec). A 3,900-gold shop upgrade that took gold and did nothing —
  `getStartingBlessingCount()` had zero callers. Now rolls N distinct pure-upside
  blessings from a 14-entry pool at run start. Full write-up moved to
  `BACKLOG-archive.md`. **No playtest filed** — see the write-up for why, and for
  the pool-magnitude knob.

## Later

- [x] **FEAT-PWA-OFFLINE** — installable, offline-capable PWA (done —
  4a0c864). Full write-up moved to `BACKLOG-archive.md`. Playtest follow-up
  filed as **POLISH-PWA-OFFLINE** under `## Human gates`.

- [x] **FEAT-DAILY-SHARE** — one-tap shareable daily-challenge result (done —
  92f3d5f). Full write-up moved to `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-DAILY-SHARE** under `## Human gates`.

- [x] **BUG-TRAIL-GHOST** — motion trails ghosting forever as ship-shaped
  chevron trains (operator-reported: "ship-shaped train that never clears")
  (done — 6e8c50a). Full write-up moved to `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-TRAIL-FIX** under `## Human gates`.

- [x] **CHORE-CI-DEPLOY-RETRY** — auto-retry the transiently-failing Pages
  deploy (done — 34e5373). Full write-up moved to `BACKLOG-archive.md`.

- [ ] **CHORE-ARCH-DOC-SYNC** — re-sync the architecture overview's content
  inventory. Value: `references/architecture-overview.md` is the
  agent-facing source of truth (CLAUDE.md points every session at it) but
  predates the July content wave — it still says 16 weapons / 3 bosses and
  omits gauntlet mode, endless cycle mutators, and Paragon affixes, so
  fleet sessions plan against stale facts. Done when: the inventory
  sections (weapon table, boss/miniboss lists, modes, scene flow) match the
  code as-built (19 weapons, 5 bosses, gauntlet, endless mutators, boss/
  miniboss/Paragon affixes); facts corrected only — no prose rewrite.
  Pointer: `references/architecture-overview.md`.

- [ ] **POLISH-GLYPH-SWEEP-2** — finish the non-HUD glyph sweep. Value: the
  2026-07-04 HUD skin pass (drawn pause/dash/ult/fullscreen icons, DISPLAY_FONT
  typography, kills/gold stack, mastery star badge) removed every rendered emoji
  from in-run surfaces, but left two typographic text glyphs by choice: the `✓`
  victory mark in the pause-menu run history (`PauseMenuManager.ts` ~1958) and
  `→` arrows in streak/evolve strings. If those ever render via a system
  fallback font on some platform, swap them for drawn ticks/labels. Also
  consider promoting the drawn four-point-star helper (duplicated in
  `HUDManager.ts` + `TouchActionButtons.ts`) into a shared visual util.

- [x] **POLISH-FONT-CANVAS-PRELOAD** — make Phaser text wait for the webfonts
  (done — a9a8b95). Full write-up moved to `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-FONT-METRICS** under `## Human gates`.

- [x] **FEAT-PWA-INSTALL-PROMPT** — surface "Add to Home Screen" (done —
  5687c15). Full write-up moved to `BACKLOG-archive.md`. Playtest follow-up
  filed as **POLISH-PWA-INSTALL-PROMPT** under `## Human gates`.

- [x] **BUG-VITALITY-HEAL-DEAD** — `vitality`'s "also heal for the bonus" never
  reached the player (done — 9b520d0). Fixed as a class: Vitality, Fortify,
  Vitality Core + Armor Plate all landed heals on a mirror field the ECS never read.
  Full write-up moved to `BACKLOG-archive.md`. Playtest follow-up filed as
  **POLISH-VITALITY-HEAL** under `## Human gates`.
- [x] **BUG-MENUBUTTON-SETVARIANT-NOOP** — `MenuButton.setVariant()` stored the
  variant and explicitly no-opped the repaint (done — 8223516). Full write-up
  moved to `BACKLOG-archive.md`. Playtest follow-up filed as
  **POLISH-MENUBUTTON-VARIANT** under `## Human gates`.
- [x] **BUG-BLOOD-PACT-HALVE-DEAD** — the Blood Pact charged half its advertised price,
  and charged *less* the more hurt you were (done — afe1baa). `applyShrineBargain()`'s
  `blood_pact` deal wrote the halved HP to `playerStats.currentHealth`, a write-through
  *mirror* of ECS `Health.current` that nothing reads back down: `syncStatsToPlayer` only
  clamps HP **downward to max** and `grantBuildHeal` is heal-only by design, so the net
  effect was `Health.current = min(oldCurrent, floor(oldMax/2))` instead of
  `max(1, floor(oldCurrent/2))`. The cost was **inverted** — at full HP the clamp halved
  you correctly by accident, at 120/200 you paid 20 instead of 60, and at or below half
  health you paid **nothing at all**, making the game's headline mid-run gamble a free
  permanent damage doubling exactly when you'd reach for it (`damageMultiplier *= 2` always
  landed via `syncStatsToPlayer` → `applyMultipliers`). Fires often: `shrine_bargain` is a
  `weight: 10, minGameTime: 120` random event and is 1 of 3 uniformly-picked deals. Fixed
  by the idiom the sibling walk-in Blood Altar (`triggerShrine`'s `sacrifice` case) already
  used 3,500 lines up — *"Authoritative HP is the ECS Health component — mutate it
  directly."* — a textbook **Parallel code path consistency** miss. **No number changes**;
  the `Math.max(1, …)` floor still means the pact can never kill you. Last member of the
  dead-mirror-write class opened by BUG-VITALITY-HEAL-DEAD (`9b520d0`), which closed only
  the upward (heal) half — every other mid-run HP write already mutates the ECS on the
  adjacent line. The item's own `grantBuildHeal` pointer was a **false lead** (it has 4
  callers; a bidirectional version would double-drain every `maxHealth`-shrinking caller).
  Full write-up in `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-BLOOD-PACT**
  under `## Human gates`.
- [x] **FEAT-PRACTICE-SHIP** — pick the ship you practise as (done — e0f72e7).
  The PRACTICE menu gained a SHIP row cycling all 11 ships (unlocked or not); the
  sandbox previously hard-coded `ship_default`, so every ship axis — six stat
  multipliers, hull, palette and, since FEAT-SHIP-ULTIMATES, the ultimate — was
  judged through Sparrow. Full write-up in `BACKLOG-archive.md`. Playtest follow-up
  filed as **POLISH-PRACTICE-SHIP** under `## Human gates`.
- [x] **BUG-PRACTICE-PORTRAIT** — the practice menu was unusable on a phone in
  portrait (done — a802fcd). `PracticeScene` was the only menu scene that never
  opted into the orientation-matched 720×1280 fit, so in portrait it squashed to the
  landscape fit (0.5625) and rendered START's whole 52-unit button *below* the 1280-unit
  canvas — the six-session practice sandbox, and the tool the `POLISH-PRACTICE-*`
  playtest queue depends on, could not be started at all. The bottom reserve was also
  6 units short in *both* orientations (130 reserved, 136 needed). Full write-up in
  `BACKLOG-archive.md`. Playtest follow-up filed as **POLISH-PRACTICE-PORTRAIT** under
  `## Human gates`.
- [x] **BUG-MENU-FLIP-RESETS-PICKS** — rotating the device threw away what you
  picked (done — 5dfb3bc). Filed as `BUG-PRACTICE-FLIP-RESETS-PICKS` (practice
  only); shipped wider because the same root cause hit the **main PLAY path**.
  `main.ts`'s orientation watcher re-lays-out live menu scenes with
  `scene.restart(...)`, and the scenes could not tell that restart from a fresh
  entry: `PracticeScene.create()` reset all four picks, and `WeaponSelectScene`
  restarted its 3-step flow at step 1. The restart now carries `relayout: true` and
  both scenes honour it. Full write-up in `BACKLOG-archive.md`. Playtest follow-up
  filed as **POLISH-MENU-FLIP-STATE**; the third instance is filed as
  **BUG-PACTSELECT-FLIP-RESETS-PICKS**, both below.
- [x] **BUG-PACTSELECT-FLIP-RESETS-PICKS** — rotating while choosing pacts threw away
  your pacts (done — fa0ea8e). The third and last known instance of the flip-resets
  class (after `BUG-MENU-FLIP-RESETS-PICKS`, `5dfb3bc`), and it sat on the last screen
  of the main PLAY path. `PactSelectScene.init()` cleared `selectedIds` unconditionally,
  so the watcher's re-layout restart wiped them. **The fact this item asked to verify
  first turned out FALSE**, which is why it wasn't shipped blind: `createCard()`
  hardcoded the unselected look and never read `selectedIds`, so preserving the set
  alone would have painted "selected" state onto unselected-looking cards — worse than
  the bug. The fix pairs the guard with a single `paintCardSelection()` that the card
  rebuild and a tap both go through. Full write-up in `BACKLOG-archive.md`. Playtest
  follow-up filed as **POLISH-PACTSELECT-FLIP** under `## Human gates`.

---

## Human gates

Never agent work. The fleet must not do any of these.

- **Push / deploy:** the repo has `origin` and **a push to `master` auto-deploys GitHub
  Pages** (`.github/workflows/deploy.yml`). Pushing is an explicit human action — agents
  never `git push` or add remotes. Publishing/store submission likewise.
- **Playtest queue** (code complete; needs a human in a browser — agents must not retune
  blind):
  - **POLISH-WEAPON-SCATTER** — the new Scattergun needs a balance/feel eyeball
    (FEAT-WEAPON-SCATTER, `ae3b27a`). Agents have no browser. Reach it:
    PRACTICE → WEAPON row → "Scattergun" (unlocked or via a normal run's weapon
    offers). Check: (a) does it read clearly as a shotgun — a fan of pellet streaks
    with a muzzle flash, short reach, wide cone; (b) base damage 9 × 5 pellets /
    cooldown 1.2 / pellet length 240 / spread 0.9rad / half-width 14 / knockback 45
    vs peers — dead or oppressive?; (c) does pellet-count scaling (5 → 9 at Lv10,
    +3 at evolution) feel like a growing wall of shot or too dense; (d) does aiming
    at the NEAREST enemy feel right, or does the cone point the wrong way in a
    surround (a "densest-cluster" or "toward-movement" aim is the obvious
    alternative — that is a balance/design call, do NOT let an agent pick one);
    (e) does Point Blank mastery (×1.6 within 90px) reward brawling; (f) does the
    Devastator evolution (×1.5 dmg, +3 pellets, ×1.25 range, ×1.2 size, 10% faster)
    land as a real spike; (g) does Cold Snap synergy with Frost Nova read (freeze
    the cluster, then shred it); (h) does the pellet fan + muzzle flash read at all
    three quality levels (note: on LOW quality the per-pellet end-dot is dropped —
    the streaks still draw). All knobs are the top-of-file consts in
    `src/weapons/ScattergunWeapon.ts` + the evolution/synergy multipliers — do not
    retune blind.
  - **POLISH-BOSS-OBELISK** — the new Obelisk boss needs a balance/feel eyeball
    (FEAT-BOSS-OBELISK, `dac5386`). Agents have no browser. Reach it:
    PRACTICE → BOSS row → "The Obelisk" (or a normal run / gauntlet — it now
    cycles in the boss order). Check: (a) does it read as a looming monolith that
    projects full-arena walls of telegraphed strikes with a single moving safe
    lane you thread; (b) base HP 4700 (×2 = 9400) / contact 33 / strike dmg
    23-33 / blast radius 88 / rows 2→2→3 by phase / reload 3.0/2.7/2.4s vs the
    other 6 bosses — dead or oppressive?; (c) is the wall fuse
    (1.27/1.14/1.01s leading row, +0.5s per following row) a fair thread window
    or too tight/too loose; (d) with GAP_HALF=140 the clear lane is ~130-210px —
    does threading gap A then sliding to gap B (GAP_ROW_SHIFT=3 columns) demand
    real movement without being unfair; (e) does alternating orientation
    (horizontal/vertical each barrage) + rotating gap force good repositioning or
    feel random; (f) does the arena-relative wall (boss looms at centre) read as
    distinct from Pulsar's boss-relative rotating spokes; (g) does the monolith
    drawer + green telegraphs read at all three quality levels (note: on LOW
    quality no boss telegraphs render — pre-existing for all bosses). All knobs
    are the top-of-file consts in `src/ecs/systems/enemy-ai/obelisk.ts` +
    `obelisk-barrage.ts` — do not retune blind. **Design opens (not agent calls):**
    the boss ships single-geometry (wall) with phase escalation, unlike Pulsar's
    two geometries — note if you want a distinct phase-2+ second geometry (e.g. a
    perpendicular cross wall or a pincer from two edges).
  - **POLISH-MINIBOSS-BOMBARD** — the new Bombard miniboss needs a balance/feel
    eyeball (FEAT-MINIBOSS-BOMBARD, `b89267f`). Agents have no browser.
    Reach it: PRACTICE → BOSS/target row → "The Bombard" (or a normal run — it
    now spawns at 540s, and in endless). Check: (a) does it read as a siege
    platform that kites at range and drops telegraphed mortar clusters (center +
    ring) on your position; (b) base HP 420 / speed 70 / contact+strike dmg 30 /
    blast radius 62 / salvo cadence 2.6s / range band 320±80 vs the other 6
    minibosses — dead or oppressive?; (c) is the center 1.1s / satellite 1.35s
    fuse a fair dodge window or too tight/too loose; (d) does the 6-strike cluster
    (center + 5 satellites at r=95) demand real repositioning without being
    unfair; (e) does adding a 6th scheduled miniboss (all six now appear per run,
    Bombard at 540 ramping into the 600 boss) feel like good escalation or too
    busy; (f) does it feel distinct from the Necromancer (kites+shoots) and the
    Pulsar boss; (g) does the drawer + telegraphs read at all three quality
    levels (note: on LOW quality no telegraphs render — pre-existing for all
    enemies). All knobs are the top-of-file consts in
    `src/ecs/systems/enemy-ai/bombard.ts` + `bombard-barrage.ts` — do not retune
    blind.
  - **POLISH-BOSS-PULSAR** — the new Pulsar boss needs a balance/feel eyeball
    (FEAT-BOSS-PULSAR). Agents have no browser. Reach it: PRACTICE → BOSS row →
    "The Pulsar". Check: (a) does it read as a spinning star flinging rotating
    spoke-waves of telegraphed strikes, with wide safe wedges between arms; (b)
    base HP 4600 (×2 = 9200) / contact 32 / strike dmg 21-31 / blast radius 60 /
    spokes 4→6 by phase vs the other 5 bosses — dead or oppressive?; (c) does the
    phase-2+ converging-ring "collapse" barrage read as a shrinking safe zone with
    a findable rotating gap, or is it unfair/unreadable; (d) is the reload cadence
    (3.05/2.70/2.35s) too busy or too idle; (e) does the spin + spoke drawing read
    at all three quality levels (note: on LOW quality no boss telegraphs render —
    pre-existing for all bosses); (f) does it feel distinct from The Bastion. All
    knobs are the top-of-file consts in `src/ecs/systems/enemy-ai/pulsar.ts` +
    `pulsar-barrage.ts` — do not retune blind.
  - **POLISH-WEAPON-RAILGUN** — the new Railgun needs a balance/feel eyeball
    (FEAT-WEAPON-RAILGUN, `142154d`). Agents have no browser. Reach it: PRACTICE →
    WEAPON row → "Railgun" (unlocked or via a normal run's weapon offers). Check: (a) does
    the lance read clearly as an instant rail beam that locks onto and skewers the toughest
    enemy, with a muzzle flash at the ship and an impact bloom on the target; (b) base
    damage 48 / cooldown 1.5 / half-width 18 / pierce 2 (→6 at Lv10) vs peers — dead or
    oppressive?; (c) does locking the highest-HP enemy feel good against bosses/elites, or
    does it waste the shot re-locking whenever HP order shuffles among a crowd (a
    "highest-max-HP" or "sticky lock" rule is the obvious alternative — that is a balance
    call, do NOT let an agent pick one); (d) does Killshot mastery (2× to the locked
    target) and the Annihilator evolution (×1.6 dmg, +3 pierce, ×1.3 width/size, 15%
    faster) land as real spikes; (e) does Siege Protocol synergy with Singularity read
    (pull the horde into a clump, lance the line); (f) does the lance read at all three
    quality levels. All knobs are the top-of-file consts in `src/weapons/RailgunWeapon.ts`
    + the evolution/synergy multipliers — do not retune blind.
  - **POLISH-WEAPON-STORM** — the new Storm Caller needs a balance/feel eyeball
    (FEAT-WEAPON-STORM, `b713251`). Agents have no browser. Reach it: PRACTICE →
    WEAPON row → "Storm Caller" (unlocked or via a normal run's weapon offers). Check:
    (a) do the bolts read clearly as lightning striking down onto enemies across the
    whole field, not just near the ship; (b) base damage 18 / cooldown 1.6 / splash
    radius 44 / bolts 1→5 at Lv10 vs peers — dead or oppressive?; (c) does random
    targeting feel good, or waste bolts on already-dying / lone enemies — a
    "lowest-HP finisher" or "densest-cluster" target rule is the obvious alternative,
    but that is a balance call, do NOT let an agent pick one; (d) do Thunderclap
    mastery (0.4s stun on strike) and Maelstrom evolution (+2 bolts, ×1.6 dmg, ×1.3
    splash, ×1.25 size) land as real spikes; (e) does Overcharge synergy with Chain
    Lightning read; (f) does the vertical jagged bolt + impact glow read at all three
    quality levels. All knobs are the top-of-file consts in `src/weapons/StormWeapon.ts`
    + the evolution/synergy multipliers — do not retune blind.
  - **POLISH-WEAPON-SWEEP** — the new Arc Sweep needs a balance/feel eyeball
    (FEAT-WEAPON-SWEEP, `2fbabcb`). Agents have no browser. Reach it: PRACTICE →
    WEAPON row → "Arc Sweep" (unlocked or via a normal run's weapon offers). Check:
    (a) does the rotating beam read clearly as a sweeping searchlight; (b) base damage 8 /
    tick cooldown 0.35 / beam length 190 / rotation 2.4 rad·s / half-width 16 / knockback 40
    vs peers — dead or oppressive?; (c) does spoke scaling (1 → 5 at Lv10, +1 at Mastery,
    +2 at evolution = 8) carpet the field or feel great; (d) do Solar Flare mastery (+1
    spoke, 35% wider) and Corona evolution (1.4× rotation, 1.6× damage, 1.3× range/size,
    +2 count) land as real spikes; (e) does Gyre synergy with Orbiting Blades read. All
    knobs are the top-of-file consts in `src/weapons/SweepBeamWeapon.ts` + the evolution/
    synergy multipliers — do not retune blind.
  - **POLISH-WEAPON-MINE** — the new Proximity Mines needs a balance/feel eyeball
    (FEAT-WEAPON-MINE, `470a319`). Agents have no browser. Reach it: PRACTICE →
    WEAPON row → "Proximity Mines" (unlocked or via a normal run's weapon offers).
    Check: (a) do the mines read clearly as armed traps that blink faster near expiry
    and blast on trigger; (b) base damage 30 / cooldown 2.8 / blast radius 88 /
    trigger 46 / lifetime 8s vs peers — dead or oppressive?; (c) does count scaling
    (1 → 5 mines at Lv10, +1 at Mastery, +1 at evolution) carpet the field too densely
    or feel great; (d) Minefield mastery + Cluster Mines evolution land as real spikes;
    (e) Kill Zone synergy with Singularity (pull-onto-mines) actually reads; (f)
    knockback 130/200 reads as radial. All knobs are the top-of-file consts in
    `src/weapons/MineWeapon.ts` + the evolution/synergy multipliers — do not retune
    blind.
  - **POLISH-WEAPON-PULSE** — the new Pulse Cannon needs a balance/feel eyeball
    (FEAT-WEAPON-PULSE, `8e0f453`). Agents have no browser. Reach it: PRACTICE →
    WEAPON row → "Pulse Cannon" (unlocked or via a normal run's weapon offers). Check:
    (a) the rings read clearly as expanding shockwaves under the ship and enemies
    (GROUND_EFFECTS depth); (b) base damage 16 / cooldown 2.2s / range 200 / speed 560
    feels neither dead nor oppressive vs peers — retune only by eye; (c) concentric
    rings-per-pulse scaling (1 → 5 at Lv10, +multishot, +2 at evolution) isn't visually
    noisy or a single-target overkill; (d) Concussion Wave (mastery, 0.4s stun) and
    Resonance Cascade (evolution) land as real power spikes; (e) Resonance Field synergy
    with aura toasts and applies; (f) knockback (60 / 110 evolved) reads as radial. All
    knobs are the top-of-file consts in `src/weapons/PulseWeapon.ts` + the evolution/
    synergy multipliers — do not retune blind.
  - **POLISH-SHIP-PAINT-PICKER** — players can now choose or revert their hull paint
    (FEAT-SHIP-PAINT-PICKER, `ddc54be`). Agents have no browser; this is a new scene +
    interaction flow and must be eyeballed. Reach it: MAIN MENU → **PAINT** deck card. Check:
    (a) the main menu shows a PAINT card that opens the picker scene; (b) tapping an unlocked
    paint turns it EQUIPPED (green) and the next run's hull/glow/engine/trail render it; (c)
    tapping SHIP DEFAULT reverts to the ship's own signature colour on the next run; (d)
    locked paints show dim with a readable `UNLOCK: <hint>` line and are not tappable and not
    keyboard/gamepad-focusable; (e) portrait + landscape layout — the 14-card grid (13 paints
    + SHIP DEFAULT) fits without clipping the title or BACK button, and the 9-card main-menu
    deck row still reads at the shrunk portrait width; (f) the choice survives a page reload
    and a save export/import (round-trips via `survivor-ship-paint`); (g) keyboard/gamepad nav
    lands only on selectable cards + BACK, never on a locked card.
  - **POLISH-SHIP-PAINT** — earned ship paints now recolor the hull (FEAT-SHIP-PAINT,
    `0135f52`). Agents have no browser; this is a pure visual change and must be eyeballed.
    Check: (a) **the point of the fix** — on a profile that has earned at least one cosmetic
    unlock, start a run: the ship's hull/glow/engine and its motion trail render in the
    earned paint, not the ship's signature palette. (b) **highest-rank wins** — with several
    cosmetics unlocked, the equipped paint is the highest-`rank` one in `src/data/ShipPaints.ts`
    (e.g. Golden Hull rank 8 over Inferno Trail rank 5); earning a higher-rank cosmetic
    should visibly swap the hull on the next run. (c) **each of the 13 reads well** on the
    neon hull and against the dark arena — spot-check Streak Flame (white-hot), Crit Aura
    (magenta), Level Crown (purple), Golden Hull (gold). (d) **dynamic tints still layer** —
    combo warmth, low-HP danger red, speed warm-tint and level-up flash still shift on top of
    the paint (they lerp over the base color); confirm none look broken. (e) **zero-unlock
    profile is unchanged** — a fresh profile with no cosmetics shows each ship's own signature
    color exactly as before. (f) **practice + restore** — the paint also applies in the
    practice sandbox and after a save-restore (both build the ship through the same
    `getShipNeonColor()`), confirm consistent. Design opens (none blocking, **not** agent
    calls — note if you want them): (i) should the paint override a ship's signature color at
    all, or only apply to `ship_default`? (ii) build the FEAT-SHIP-PAINT-PICKER so players pick
    a paint and can revert to the ship's own color.
  - **POLISH-MENUBUTTON-VARIANT** — `MenuButton.setVariant()` now actually
    repaints (BUG-MENUBUTTON-SETVARIANT-NOOP, `8223516`). Reach it: BootScene →
    PRACTICE (or in-run practice dock). Check that (a) tapping AFFIX to a real
    affix turns the AFFIX and (once set) 2ND buttons **magenta**, and clearing
    them returns to neutral slate; (b) selecting an ultimate turns the ULT
    button magenta; (c) INVINCIBLE: ON turns its button **safe-green**, OFF
    returns to neutral; (d) the disabled/N-A affix button reads neutral **and**
    dimmed (setEnabled alpha), not magenta; (e) hovering a button while its
    variant flips shows the glow/rim in the new colour, not the old.
  - **POLISH-SHIP-CHASE** — the locked ships now show on the ship-select step
    (FEAT-SHIP-CHASE, `f1000e7`). Agents have no browser; this is a UI-layout + readability
    change and must be eyeballed. Reach it: MAIN MENU → START (or GAUNTLET) → advance past
    CHOOSE YOUR STAGE to **CHOOSE YOUR SHIP**. Check: (a) **the point of the fix** — on a
    fresh-ish profile (only Sparrow/Interceptor/Dreadnought unlocked) the ship step now
    shows the 3 unlocked ships **plus 8 dim LOCKED cards** (Scholar, Juggernaut, Void
    Walker, Boss Hunter, Flawless, Glass Cannon, Elite Slayer, Apex). Before this a player
    never learned those ships exist. (b) **each locked card reads cleanly** — dim ship name,
    gold "LOCKED" tag, dim kit description, muted `UNLOCK: <hint>` line; spot-check Scholar =
    "Reach level 10 without using any weapon upgrades", Juggernaut = "Survive 5 minutes
    without taking damage", Apex = "Complete a world level 5 victory". (c) **locked cards are
    not selectable** — tapping one does nothing (no run start, no hover preview swap); only
    unlocked cards respond. (d) **keyboard/pad nav** — arrowing moves only between the
    *unlocked* ships and never focuses a LOCKED card; the hangar preview only ever shows an
    unlocked hull. (e) **layout** — with 11 cards (3 unlocked + 8 locked) the grid wraps to
    fit; in portrait confirm the longest description (Apex) + its UNLOCK line aren't clipped
    by the 160px card height and the grid doesn't overflow the screen; in portrait the
    hangar preview is expected to be skipped when the taller grid leaves no headroom (as
    designed). (f) **fully-unlocked profile** — once all 11 ships are unlocked there are no
    LOCKED cards and the step looks exactly as before. (g) **the chase reads** — does
    "Glass Cannon — +80% damage… — UNLOCK: Deal 100,000 damage in a single run" make you
    want to chase it, or is revealing the full kit a spoiler? Design opens this raises (none
    blocking, **not** agent calls — note if you want them): mask the ship name/kit behind
    "???" instead of revealing it; and give the **BootScene quick ship picker** the same
    locked-preview treatment (this feature is scoped to the WeaponSelectScene ship step
    only). This mirrors the identical opens filed for POLISH-STAGE-CHASE.
  - **POLISH-STAGE-CHASE** — the locked biomes now show on the stage-select step
    (FEAT-STAGE-CHASE, `6158650`). Agents have no browser; this is a UI-layout + readability
    change and must be eyeballed. Reach it: MAIN MENU → START (or GAUNTLET) → the first step is
    now **CHOOSE YOUR STAGE**. Check: (a) **the point of the fix** — on a fresh-ish profile (world
    level 1, nothing hidden-unlocked) the stage step now appears **at all** (it used to be
    skipped), showing Deep Void selectable plus **3 dim LOCKED cards** (Inferno, Crystal Caves,
    Endless Void). Before this, a new player never saw the step or learned the other biomes exist.
    (b) **each locked card reads cleanly** — dim biome name, a gold "LOCKED" tag, the dim modifier
    description, and the muted unlock hint; spot-check Crystal Caves = "Reach world level 3",
    Endless Void = "Survive 30 minutes in a single run", Inferno = "Reach world level 2" (Inferno
    unlocks at WL2, so it only shows locked at WL1). (c) **locked cards are not selectable** —
    tapping one must do nothing (no run start, no hover glow); only the unlocked card(s) respond.
    (d) **keyboard/pad nav** — arrowing must move only between the *unlocked* cards and never focus
    a LOCKED card; the focus highlight lands only on selectable biomes. (e) **layout** — with 4
    cards (1 unlocked + 3 locked) at portrait 720w the grid wraps to fit; confirm the LOCKED cards'
    hint line isn't clipped by the 160px card height and the grid doesn't overflow the screen edge
    in portrait or landscape. (f) **fully-unlocked profile** — once all 4 stages are unlocked there
    are no LOCKED cards and the step looks exactly as it did before. (g) **the chase reads** — does
    "Crystal Caves — +20% XP, tougher enemies — Reach world level 3" make you want to chase it, or
    is revealing the modifiers a spoiler? Design calls this opens (none blocking, **not** agent
    calls — note if you want them): mask the biome name behind "???" instead of revealing it; add a
    live progress bar toward the unlock (the menu has no run context, so only lifetime-based
    conditions could show progress pre-run); and give the SHIP step the same locked-preview
    treatment (locked ships are hidden the same way today).
  - **POLISH-CODEX-EVOLUTIONS** — the new Codex → Evolutions tab (FEAT-CODEX-EVOLUTIONS,
    `d4099c5`). Agents have no browser; this is a UI-layout + readability change and must
    be eyeballed. Reach it: main menu → **Codex** → the **Evolutions** tab (7th tab, "dna"
    icon, count badge "19"). Check: (a) **the 7-tab bar is the top risk** — a seventh tab makes
    every tab ~90px wide at portrait 720w (down from ~106px with six); confirm the labels
    ("Statistics", "Evolutions", "Synergies" are the longest, all 9–10 chars) don't clip or
    overlap their count badges or icons in **portrait (720w)** and landscape. This compounds
    the same 6-tab concern flagged for POLISH-CODEX-RELICS; if it's now too tight, the fix is a
    human/design call (shrink the tab font, abbreviate labels, or go icon-only tabs) — **not**
    an agent call; note which you'd want. (b) **it lists all 19** recipes as 2-column
    scrollable cards; scroll to the bottom and confirm none are clipped by the card height
    (120px) — the flavor description is the tightest line and the longest ("A ravenous well
    with a far wider event horizon that grinds the trapped horde with crushing tidal force.",
    Black Hole) may wrap to three lines. (c) **each card reads cleanly** — the evolved form name
    (bold white), the amber recipe line `<Weapon> Lv5  +  <Stat> Lv5`, the green power-gain line,
    the grey flavor description, and the base weapon icon in the left disc tinted amber. (d)
    **the recipe is right** — spot-check Blade Dancer = `Katana Lv5 + Swiftness Lv5`, Void
    Vortex = `Orbiting Blades Lv5 + Might Lv5`, Death Ray = `Laser Beam Lv5 + Piercing Lv5`.
    (e) **the power-gain line is right** — spot-check Blade Dancer = `+50% dmg · 50% faster ·
    +100% range`, Bullet Storm = `+50% dmg · +3 proj · 40% faster`. (f) **keyboard/pad nav** —
    arrow into the grid; the focus highlight (thick gold border) moves card-to-card and, when
    it leaves a card, the border returns to the normal `0x4a4a7a` (no stuck gold). (g) **the
    other six tabs are unchanged** — Weapons/Bestiary/Upgrades/Synergies/Relics/Statistics still
    render and their counts are unaffected. Balance/feel calls this opens (none blocking):
    should the flavor description be dropped for a cleaner card, or should the card also show
    each weapon's evolved icon (currently it shows the base weapon icon only)? Both are
    enhancements, **not** agent calls — note if you want them.
  - **POLISH-CODEX-RELICS** — the new Codex → Relics tab (FEAT-CODEX-RELICS, `759a1cd`).
    Agents have no browser; this is a UI-layout + readability change and must be eyeballed.
    Reach it: main menu → **Codex** → the **Relics** tab (6th tab, "crown" icon, count badge
    "28"). Check: (a) **the 6-tab bar is the top risk** — a sixth tab makes every tab ~18px
    narrower (≈106px at portrait 720w); confirm the labels ("Statistics" and "Synergies" are
    the longest) don't clip or overlap their count badges or icons in **portrait (720w)** and
    landscape. If it's too tight, the fix is a human/design call (shrink the tab font,
    abbreviate labels, or icon-only tabs) — **not** an agent call; note which you'd want.
    (b) **it lists all 28** relics as 2-column scrollable cards; scroll to the bottom and
    confirm none are clipped by the card height (96px) — the description is the tightest line
    and the longest ("+2 pandemic spread (poison jumps to nearby enemies)") may wrap to two
    lines. (c) **each card reads cleanly** — relic name (bold white), the rarity label in its
    rarity colour, the grey effect description, and the relic icon in the left disc tinted the
    rarity colour. (d) **rarity colours are right** — common = grey `#aaaaaa`, rare = blue
    `#4488ff`, epic = purple `#cc44ff`, legendary = amber `#ffaa22`; spot-check Steady Eye =
    COMMON (grey), Overclock = RARE (blue), Executioner = EPIC (purple), Crown of Havoc =
    LEGENDARY (amber). Because `RELICS` is authored in rarity order, the cards read roughly
    common→legendary top to bottom. (e) **keyboard/pad nav** — arrow into the grid; the focus
    highlight (thick gold border) moves card-to-card and, when it leaves a card, the border
    returns to the normal `0x4a4a7a` (no stuck gold). (f) **the other five tabs are
    unchanged** — Weapons/Bestiary/Upgrades/Synergies/Statistics still render and their counts
    are unaffected. Balance/feel calls this opens (none blocking): should relic cards be
    discovery-gated like weapons (turning relics into a collectible completion set), or show
    each relic's drop source / rarity weight? Both are enhancements, **not** agent calls —
    note if you want them.
  - **POLISH-CODEX-SYNERGIES** — the new Codex → Synergies tab (FEAT-CODEX-SYNERGIES,
    `37a45d3`). Agents have no browser; this is a UI-layout + readability change and
    must be eyeballed. Reach it: main menu → **Codex** → the **Synergies** tab (5th tab,
    "chain"/linked-rings icon, count badge "15"). Check: (a) **it lists all 15** synergies
    as 2-column scrollable cards; scroll to the bottom row and confirm none are clipped by
    the card height (108px) — the flavor description is the tightest line and may wrap to
    two lines. (b) **each card reads cleanly** — synergy name (bold), the two weapon names
    ("Frost Nova + Meteor"), the amber bonus badge ("+30% dmg", "+15% atk spd", or both),
    the grey flavor line; and the **two weapon icons** render in the left gutter joined by
    a "+". (c) **the numbers are right** — spot-check Thermal Shock = **+30% dmg**, Blade
    Dance = **+15% atk spd** (no dmg), Conducting Field = **+15% dmg · +10% atk spd**.
    (d) **five tabs still fit** the bar on a phone (portrait 720w and landscape) without
    the labels overlapping — "Synergies"/"Statistics" are the longest. (e) **keyboard/pad
    nav** — arrow into the grid; the focus highlight (thick gold border) moves card-to-card
    and, when it leaves a card, the card's border returns to the normal `0x4a4a7a` (no
    stuck gold). (f) **the other four tabs are unchanged** — Weapons/Bestiary/Upgrades/
    Statistics still render and their discovered/total counts are unaffected.
    Balance/feel calls this opens (none blocking): should synergy cards be gated behind
    discovery like weapons, or link to the weapons that form them? Both are enhancements,
    **not** agent calls — note if you want them.
  - **POLISH-BLOOD-PACT** — the pact that now charges its price (BUG-BLOOD-PACT-HALVE-DEAD,
    `afe1baa`). Agents have no browser, and this is the one recent fix that makes the
    game **harder** — it must not be retuned blind. Reach it: play past 2:00 and wait for
    the `Shrine of Sacrifice` event (weight 10); it rolls Blood Pact ~1 time in 3.
    Check: (a) **the point of the fix** — take it at **full** HP: behaviour should be
    unchanged (you were always halved correctly here by accident of the clamp). (b) **the
    bug this fixes** — take it at **~25% HP**: you must now drop to ~12% of the old max
    (against the new halved max), where before you paid *nothing*. Does that read as a
    fair price you agreed to, or as an ambush? (c) **the balance question the fix opens,
    and the real reason this is here** — the deal is **randomly rolled**, not chosen: you
    cannot decline it. Is a run-long "HP halved" landing unbidden at low HP a good moment
    or a run-ender? Options if it plays badly, all cheap: gate `blood_pact` out of the
    deal pool below some HP fraction, offer the three deals as a *choice*, or soften the
    current-HP half. **All are balance calls — do not let an agent pick one.** (d) **it
    cannot kill you** — the `Math.max(1, …)` floor means the pact must always leave ≥1 HP.
    Take it at 1-2 HP and confirm you survive. (e) **the HUD agrees** — the health bar must
    show the drop immediately (it reads the ECS), and the toast must still read
    `HP halved, damage doubled`. (f) **the damage half still lands** — your DPS must still
    visibly double. (g) **the other two deals are untouched** — `Frenzy Ritual` and
    `Relic Vow` were not modified; confirm they still fire normally.
  - **POLISH-JUICE-SLOWMO** — the cinematics that never played (BUG-JUICE-SLOWMO-DEAD,
    `b7a5e47`). Agents have no browser; this is a pure feel change and must not be retuned
    blind. Check: (a) **the point of the fix** — kill a boss: after the freeze-frame there
    must now be a ~300ms slow-motion with a subtle camera zoom (`slowMotion(300, 0.25)`),
    which has never once played before this commit. Does the boss kill now land as the
    biggest moment in the game, or does the freeze→slow-mo pair read as two effects
    fighting? (b) **miniboss** — same, shorter (`150ms @ 0.4`): at endless cycle 3 (two
    minibosses per wave) does it fire often enough to become a tax on pace? **This is the
    most likely thing to be wrong** — it is the highest-frequency of the four.
    (c) **boss phase break** — at 66% and 33% HP a `450ms @ 0.45` slow-mo now follows the
    phase hit-stop: does it read as drama, or does it interrupt a fight you were winning?
    (d) **combo annihilation** — `500ms @ 0.2` on the combo threshold: with the toast and
    the shockwaves already firing, is this too much at once? (e) **the ultimate** — the
    per-ship `slowMo` tunings in `src/data/ShipUltimates.ts` (11 ships, 700-1100ms @
    0.18-0.3) now play reliably instead of only when the ult killed nothing big. Fly
    Apex (`1100ms @ 0.18`, the longest): does pressing Q feel cinematic or sluggish?
    (f) **the BOMB consumable** — `150ms @ 0.45` after a 720-radius blast. (g) **stacking,
    the correctness one** — kill a boss whose death also triggers a phase break or lands
    inside a combo threshold: exactly ONE slow-mo may play (last request wins) and the
    camera zoom **must** return to 1.0. If the HUD is ever left magnified or the game ends
    up permanently slow, that is a real bug — file it. (h) **player death still works** —
    it is the one cinematic that always played (`800ms @ 0.15`); confirm this change did
    not alter it. (i) **reduced motion** — with Reduced Motion on in SETTINGS the camera
    zoom must stay suppressed. (j) **the session-latch fix** — die during a run, then play
    3-4 more runs without reloading the page: hit stop and slow motion must still fire on
    the 4th run. Before this fix, a run ending inside a freeze window killed both for the
    rest of the session. **All knobs are the existing per-callsite arguments** (`GameScene.ts`
    `:2763`, `:2840`, `:3075`, `:3164`, `:6831`, `:7882`) and `ShipUltimates.ts`; the
    planner changed none of them.
  - **POLISH-ASCEND-CHASE** — the ascension chase is visible (FEAT-ASCEND-CHASE,
    `88c0cc3`). Agents have no browser. Reach it: MAIN MENU → SHOP. Check: (a) **the
    point of the feature** — on a fresh-ish profile (account level < 50, never ascended),
    does the shop now tell you prestige exists? The magenta line under the chips should
    read `✦ Ascend at Account Lv.50 — +10% stats, +15% gold per level`. (b) **the chip
    still chases tiers** — below account level 50 the chip should read `▶ Lv.N` for the
    next unlock tier (10/15/20/30/50) with a **cyan** bar; unchanged from before. (c)
    **the bug this fixes** — this needs an ascension. At account level 50, ASCEND, then
    rebuy with the refunded gold up to account level 50 again: the chip must now read
    `✦ Lv.65` on a **magenta** bar, **not** `ALL UNLOCKED` on a full gold bar, and the
    hint must read `✦ Next ascension at Account Lv.65`. (d) **the button appears without
    a re-entry** — with account level 49 and gold in hand, buy one more level *while
    standing in the shop*: `✦ ASCEND ✦` must appear immediately, and the chip must flip
    to `ASCEND READY`. Before this fix you had to leave and re-enter. (e) **and
    disappears** — refund a level back below the threshold: the button must vanish and
    the hint return. (f) **layout on a phone** — in portrait and landscape, does the hint
    line collide with the ACCOUNT LV / GOLD chips or the tab strip? It sits at y=56 (or
    y=74 once you have ascended) at screen centre; the chips are at y=38 left and right.
    (g) **the two-line labels** — `ASCEND READY` and `ALL UNLOCKED` wrap to two lines at
    font 10 inside the chip: still legible, still inside the chip? (h) **the terminal
    state is unreachable in practice** — `ALL UNLOCKED` now only shows past ascension 25
    (threshold 425 > the 412 reachable ceiling). Nothing to test by play; noted so it
    isn't read as a regression.
  - **POLISH-PACTSELECT-FLIP** — rotating while choosing pacts keeps them
    (BUG-PACTSELECT-FLIP-RESETS-PICKS, `fa0ea8e`). Agents have no device to
    rotate. Check: (a) **the point of the fix** — START → stage → ship → weapon → on
    FORGE A PACT select 2 pacts, rotate: both must survive **and still look
    selected** — thick green border, `✓ SELECTED` badge, card sitting proud at 1.04
    scale — with the counter reading `2 / 3 PACTS SELECTED`. **The badge is the thing
    to watch:** before this fix the cards rebuilt unselected no matter what, and a
    state/paint mismatch is exactly the failure mode this fix exists to prevent.
    (b) **the run actually carries them** — rotate, then BEGIN RUN: the pacts' curses
    *and* rewards must both apply, and it must still be the stage/ship/weapon you
    picked (`relayout` is stripped in `init()` and must never reach GameScene).
    (c) **fresh entry still clears** — finish or quit that run, start another, reach
    the pact step: nothing may be pre-selected. If pacts are sticky across runs, the
    `relayout !== true` guard in `init()` is inverted. (d) **the layout re-fits** —
    `perRow` is computed from canvas width, so portrait wraps the pact grid into more
    rows: after a flip the rows must re-wrap cleanly with no doubled or ghost cards,
    and the last row must stay clear of BEGIN RUN. (e) **cap still caps** — select 3
    (MAX_PACTS), rotate, then tap a 4th: the counter must still flash red
    `MAX 3 PACTS`, and nothing may become selected. (f) **rotate twice, and rotate
    back** — portrait→landscape→portrait: selections survive both. (g) **GAUNTLET** —
    same flow from GAUNTLET: rotating on the pact step must still begin a gauntlet
    run. (h) **skip still skips** — press Escape/B on the pact step after rotating:
    it must clear selections and begin the run with zero pacts.
  - **POLISH-MENU-FLIP-STATE** — rotating no longer discards your picks
    (BUG-MENU-FLIP-RESETS-PICKS, `5dfb3bc`). Agents have no device to rotate.
    Check: (a) **the point of the fix, practice** — BootScene → PRACTICE in portrait,
    set SHIP: JUGGERNAUT + a weapon + LEVEL 5 + EVOLVED ON, rotate to landscape: all
    four must survive, and the menu must re-fit the landscape canvas. This is the flow
    `BUG-PRACTICE-PORTRAIT` (`a802fcd`) created. It also **answers**
    POLISH-PRACTICE-PORTRAIT (e) — that check can be skipped now. (b) **the point of
    the fix, PLAY path** — START → pick a stage → on the ship step, rotate: you must
    stay on the ship step with your stage still chosen, not get bounced to step 1.
    (c) **fresh entry still resets** — the regression this could cause: after
    rotating in PRACTICE, back out to MAIN MENU and re-enter PRACTICE. Picks **must**
    be back to defaults (first weapon, its max level, EVOLVED OFF, Sparrow). If they
    are sticky, the `relayout: false` guard at `BootScene.ts:202` is not holding.
    (d) **rotate twice, and rotate back** — flip portrait→landscape→portrait: picks
    survive both, and the layout re-fits each time with no doubled/ghost cards.
    (e) **GAUNTLET still gauntlets** — GAUNTLET → rotate on the ship step → finish the
    run start: it must still be a gauntlet run (the launch payload is spread through
    the restart, so `gauntletMode` should survive). (f) **the weapon step's keyboard
    shortcuts** — on desktop, rotate/resize into the weapon step and press a number
    key: still selects.
  - **POLISH-PRACTICE-PORTRAIT** — the practice menu in portrait (BUG-PRACTICE-PORTRAIT,
    `a802fcd`). **Do this before the other practice playtests — it is what makes
    them reachable on a phone held normally.** Reach it: hold the phone in **portrait**
    → BootScene → PRACTICE. Check: (a) **the point of the fix** — is the START button
    fully on screen and tappable? Before this it rendered entirely below the canvas edge
    and portrait practice was impossible. (b) **the whole column** — SHIP row, its two
    info lines, LEVEL stepper, EVOLVED, START: all on-canvas, legible, and none
    overlapping the weapon grid? (c) **the dead band** — the grid ends around y=743 and
    the SHIP row starts around y=1002, leaving ~260 units of empty space mid-screen in
    portrait; the planner left it (the scene is functional and centering the column is a
    composition change, not a fix). On the screen does it read as breathing room or as
    broken? (d) **the 5×4 weapon grid** — portrait fits 5 columns instead of landscape's
    8, so 19 weapons take 4 rows: still legible and tappable? (e) **rotate mid-menu** —
    set up a run, rotate: the layout should re-fit correctly, but
    your picks now **survive** the rotate (fixed since, `BUG-MENU-FLIP-RESETS-PICKS`) —
    covered by **POLISH-MENU-FLIP-STATE** above, so just confirm the re-fit here.
    (f) **landscape is meant to be untouched** — the only landscape
    change is the whole control stack moving **up 10 units** (START now clears the
    bottom edge by 4 instead of overhanging it by 6). Does landscape look identical
    otherwise?
  - **POLISH-PRACTICE-SHIP** — pick the ship you practise as (FEAT-PRACTICE-SHIP,
    `e0f72e7`). Reach it: BootScene → PRACTICE → tap the `SHIP` row to
    `JUGGERNAUT` → START. Check: (a) **the point of the feature** — with the dock's
    `ULT: SHIP` row, can you now answer BALANCE-SHIP-ULTIMATES (a) "is Q a different
    button" *on the ship it belongs to*, in two practice runs instead of eleven real
    ones? (b) **the ship description** — it still ends "Starts with Ground Spike."
    while practice flies the weapon *you* picked from the grid (GameScene's
    `!practiceModeActive` guard suppresses the ship's weapon, deliberately). The
    planner left the string verbatim rather than mangle shipped data — on the screen
    does it read as a contradiction, or does the highlighted weapon card make it
    obvious? If it misreads, the fix is the human's call: strip the sentence, or
    reword the descriptions. (c) **11 taps** — the row cycles forward only, like the
    dock's `ULT:` row; is Apex (last) annoying to reach? (d) **locked ships** — every
    ship is flyable here on purpose; does that undercut the unlock chase, or read as
    a sandbox doing its job? (e) **the two info lines** — do the description and
    `ULT — …` lines fit above the LEVEL row on a phone in landscape, or do they
    collide?
  - **BALANCE-SHIP-ULTIMATES** — agents have no browser and must not retune blind.
    Reach it: BootScene → START → pick a ship; the card now names its ultimate. Check:
    (a) **the point of the feature** — fly Juggernaut then Scholar: does Q feel like a
    *different button*, or just a recoloured nova? (b) **the tuning knob** — all 11
    numbers live in `SHIP_ULTIMATES` (`src/data/ShipUltimates.ts`); the planner set them
    by ship identity, never by play. Suspected outliers to judge first: `siege_pulse`
    (×2.0 damage at 0.6 radius — is the trade legible?), `bulwark_slam` (1,200
    knockback — does it scatter the screen usefully or just push kills out of reach?),
    `pristine_aegis` (full heal + 3s iframes — too strong on a ship that already earns
    +100% gold?), `insight_surge` / `critical_cascade` (a buff window with almost no
    blast — does a near-damageless ultimate feel bad to press?). (c) **the ship card**
    — one extra wrapped line: does it still fit on a phone in portrait, or does the
    card need to grow? (d) **the toast** — a 2.2s toast on every ult: helpful the first
    time, noise by the tenth?
  - **POLISH-PRACTICE-ULT** — fire any ship's ultimate on demand (FEAT-PRACTICE-ULT,
    `9288a23`). Reach it: BootScene → PRACTICE → START, dock → set `ULT: BULWARK
    SLAM`, tap `FIRE ULT`, then `ULT: INSIGHT SURGE`, fire again. Check: (a) **the
    point of the feature** — can you now answer BALANCE-SHIP-ULTIMATES (a) "is Q a
    different button" in one run instead of eleven? (b) **the dock at 10 rows** —
    this supersedes POLISH-PRACTICE-BUILD (f): rows now auto-shrink to fit; on a
    phone in landscape are all ten still legible and tappable, and do
    `TARGET`/`SPAWN` clear the edges? (c) **two gold buttons** — `FIRE ULT` sits
    directly above `SPAWN`: does that misfire in a fight? (d) **`ULT: SHIP`** — does
    the default read as "the ship's own", or is it ambiguous on a sandbox that is
    always Sparrow? (e) the `U` key. **Note the known limit:** practice flies
    `ship_default`, so an overridden ultimate fires with **Sparrow's** stats — the
    nova scales with `playerStats.damageMultiplier`, so absolute damage reads
    Sparrow-flavoured; the sandbox answers *relative* "does it feel different" well,
    absolute tuning still wants a real run (this is the same relative-vs-absolute
    caveat POLISH-PRACTICE-BOSS carries).
  - **POLISH-PRACTICE-MODE** — practice mode on a real device (agents have no
    browser). This one is worth doing first: it is the tool for draining the rest
    of this queue. Reach it: BootScene → **PRACTICE**. Check: (a) **the point of
    the feature** — pick Caustic Wake / Guardian / Sentry at level 5 + EVOLVED,
    hit START: does the run begin with exactly that weapon at that level, and can
    you now judge POLISH-WEAPON-WAKE / -GUARDIAN / -SENTRY in seconds instead of a
    10-minute RNG-gated run? (b) **isolation, the safety-critical one** — note
    your gold / achievement count / codex before practising, do a practice run
    that would normally unlock plenty (max-level weapon, many kills), quit, and
    confirm **nothing moved**: gold, achievements, codex, records, and that no
    "CONTINUE" save was left behind. (c) **exit reloads** — QUIT / RESTART /
    QUIT-TO-SHOP from a practice run each reload the page back to the menu; that
    is deliberate (it drops the in-memory state a practice run dirtied), but is
    the reload flash acceptable, and is it instant on the second boot
    (service-worker cache)? (d) **the 8-card deck row in portrait** — PRACTICE is
    the 8th card; the row auto-shrinks to fit, so are the cards still legible and
    tappable on a phone, or does the row need to wrap to two rows? (e) **level
    stepper** — does it clamp to each weapon's real max, and does EVOLVED dim out
    below the evolution's required level? Knobs: `PRACTICE_WEAPON_IDS` and the
    layout in `src/game/scenes/PracticeScene.ts`; the deck row in
    `BootScene.ts` (~line 1050).
  - **POLISH-PRACTICE-BOSS** — practice v2 boss sandbox on a real device
    (FEAT-PRACTICE-BOSS, `43a76b7`). Reach it: BootScene → PRACTICE → START, then
    the dock on the left edge. Check: (a) **the point of the feature** — set
    TARGET to The Bastion and AFFIX to TITAN, tap SPAWN: does a TITAN Bastion
    appear at full 10-minute strength, and can you now answer POLISH-BOSS-AFFIXES
    (c)/(d) and POLISH-BOSS-BASTION in seconds? (b) **repeatability** — kill it:
    the run must continue with no victory screen, so a second SPAWN fields the
    next one; does spawning several at once read as chaos or as useful?
    (c) **affix pairs** — AFFIX=TITAN then 2ND: TITAN and VAMPIRIC must never be
    offered together (barred as degenerate); PARAGON naming on the bar reads?
    (d) **The Legion** — selecting it greys the affix buttons to `N/A` (its splits
    can't inherit an affix): is that legible, or does it look broken? (e) **the
    dock itself** — left-edge stack at UI-scale extremes and in portrait: does it
    cover the arena, collide with the HP/XP bars, or eat joystick touches?
    (f) **INVINCIBLE** — toggling it lets you park in a boss and watch its pattern
    without dying; does it also (correctly) stop shield charges from burning?
    (g) **`B`** spawns from the keyboard. **Known limit, by design:** the practice
    player has a max-level weapon but **level-1 passives**, so absolute
    time-to-kill reads longer than a real 10-minute fight — practice answers
    *relative* questions (TITAN vs SWIFT vs none) well, and absolute "drag"
    judgements should still be sanity-checked in a real run. Knobs:
    `src/ui/PracticeDock.ts` (layout), `src/data/PracticeTargets.ts`
    (targets/scaling times).
  - **POLISH-PRACTICE-BUILD** — practice v3 build rungs on a real device
    (FEAT-PRACTICE-BUILD, `41df31c`). Reach it: BootScene → PRACTICE → pick a
    weapon at max level → START → the **BUILD** row on the left dock. Check:
    (a) **the point of the feature** — TARGET=The Bastion, AFFIX=TITAN,
    BUILD=`10-MIN`, SPAWN: does the fight now read like a real 10-minute fight,
    and can you finally answer POLISH-BOSS-AFFIXES (c) "siege or drag"?
    (b) **is 10-MIN actually representative** — depth 3 on all 9 stats =
    player level 28 (the planner's grounding: the game's own `level_30_run`
    achievement). Against your real runs, is ~28 the right rung for the 600s
    boss moment, or should depth 3 map elsewhere? Knob:
    `PRACTICE_BUILD_LADDER` in `src/data/PracticeBuild.ts`. (c) **the ladder
    reads** — OFF → 10-MIN → DEEP → MAX steps up only and greys out at MAX (by
    design: stats are additive and can't be rolled back; reload to reset) —
    does one-way read as intentional or broken? (d) **the weak-vs-strong
    comparison** — spawn at OFF, judge, step to 10-MIN, spawn again: does that
    answer POLISH-ENDLESS-MUTATORS (g) "too spongy for weak builds?"
    (e) **no modal cascade** — kill a boss at BUILD=10-MIN: you should get ~1
    level-up, not the dozen-modal cascade a level-1 chassis produces (this is
    the XP-curve fix; it also means BUILD=OFF still cascades — acceptable?)?
    (f) **6 rows** — the dock is now 6 tall: at UI-scale extremes and in
    portrait does it still clear the HP/XP bars and the arena (this extends
    POLISH-PRACTICE-BOSS (e), it is not a new question)? (g) **MAX** — all 9
    stats mastered: mastery star badges are deliberately *not* fired (9 at
    once would be noise) — is their absence confusing? **Known limit, by
    design:** relics, pacts and consumables are still absent from a practice
    build — BUILD covers the nine level-up stat passives and the meta/shop
    upgrades your profile already carries, which is the bulk of DPS but not
    100% of a real run's.
  - **POLISH-PRACTICE-TIME** — confirm the arena rows field the late run
    (FEAT-PRACTICE-TIME, `8452234`). Agents have no browser. Reach it:
    BootScene → PRACTICE → START, then the dock's ARENA / MUTATOR rows. Check:
    (a) **the point of the feature** — the three questions that were unreachable:
    set MUTATOR: SWIFT SWARM + ARENA: CYCLE 5 and answer POLISH-ENDLESS-MUTATORS
    (c) "is the cycle-5 cadence (20s floor) plus +15% speed actually readable, or
    just noise?"; MUTATOR: VOLATILE AIR + ARENA: 10-MIN for (d) "elite soup?";
    MUTATOR: IRON HORDE + ARENA: 10-MIN + BUILD: 10-MIN for (g) "+2 armor vs
    late-run DPS — too spongy?". Each should now be a ~10-second read.
    (b) **no cascade, the one most likely to be wrong** — hit ARENA: 10-MIN on a
    fresh practice run: the clock must jump to 10:00 and trash must thicken, but
    **no miniboss or boss may spawn on its own**, and **no achievement/milestone
    toasts** may fire. The dock's SPAWN must stay the only source of boss-tier
    enemies. (c) **the ratchet** — ARENA steps forward only and greys out at
    CYCLE 5; MUTATOR wraps freely both at OFF and at CYCLE 5. (d) **cycle feel** —
    at CYCLE 2 a second miniboss joins each cadence tick and the banner reads
    `CYCLE 2 · <MUTATOR>`; at CYCLE 5 trash should be ~3× the health of CYCLE 2
    (1.25^3). Is CYCLE 5 a fair fight with BUILD: MAX, or does it need a rung
    between? (e) **isolation still holds** — note gold / achievements / codex /
    best-endless-cycle before practising, run ARENA: CYCLE 5 for a minute, quit:
    **nothing may move**, and the death screen must not claim "NEW BEST!".
    (f) **8 rows in portrait** — the dock is now 8 rows tall (~282px). Still
    legible and tappable on a phone, or does it need to wrap/scroll? This
    supersedes the row-count part of POLISH-PRACTICE-MODE (d). Knobs:
    `PRACTICE_ARENA_LADDER` + `PRACTICE_MUTATOR_CYCLE` in
    `src/data/PracticeArena.ts`, `applyPracticeArena` in
    `src/game/scenes/GameScene.ts`.
  - **POLISH-TRAIL-FIX** — trail ghosting fix + ribbon smoothing (BUG-TRAIL-GHOST,
    `6e8c50a`; all knobs in `src/visual/TrailManager.ts`). Check in a real run:
    (a) **the reported bug is gone** — fly loops for 60s+, stop, wait ~3s: no
    faint ship-path smears remain anywhere (previously permanent); (b) the trail
    reads as ONE smooth ribbon behind player/fast enemies, no more repeating
    chevron "ghost ships" (uniform widths: glow 1.3×, core 0.55× — if the trail
    now feels too thin/fat, those two factors are the knobs); (c) fade cadence
    feels right on both a 60Hz and a 120Hz screen (fade is now delta-scaled;
    `FADE_ALPHA` 0.12 per 60fps-frame); (d) no screen-crossing streaks when a
    swarm dies and respawns across the map (recycled-id jump guard, 150px);
    (e) whole-screen tint got a hair darker (fade fill went 0x000008 → pure
    black) — confirm the arena background still reads as intended.
  - **POLISH-FONT-METRICS** — the game's real typography, on a real cold load
    (agents have no browser and cannot see a rendered glyph). Until now every
    player saw Arial; the fonts the repo ships have never actually rendered, so
    **every menu in the game was sized by eye against the wrong font**. Reach it:
    a hard-reload with an empty cache (DevTools → Network → Disable cache), and
    an installed-PWA cold launch. Check: (a) **do they render at all** — is menu
    body copy visibly Atkinson Hyperlegible and are headings visibly Rajdhani
    (semi-condensed, squared-off), not Arial? (b) **overflow** — Atkinson is
    *wider* than Arial, so tight panels are the risk: shop/codex/achievement
    cards, the pause menu, the run-end stats panel, the endless cycle line, and
    affix/paragon boss bars at UI-scale extremes and in portrait — anything now
    wrapping, clipping, or colliding? (c) **headings** — Rajdhani is *narrower*,
    so display text gets shorter: does any heading now look under-filled or
    off-center? (d) **cost** — does the 5-face preload (~50 KB, same-origin)
    visibly lengthen the boot loader on a cold first load, and is it instant on a
    second launch (service-worker cache)? (e) **offline** — airplane-mode cold
    launch of the installed PWA: do the fonts still apply (they are precached), or
    does it fall back to Arial? (f) **the 3 s timeout** — throttle to slow 3G:
    does the game still boot (in Arial) rather than hang? Knobs:
    `FONT_LOAD_TIMEOUT_MS` and `GAME_FONT_FACES` in `src/visual/fontLoading.ts`.

  - **POLISH-SAVE-EXPORT** — export/import round-trip on real devices. Reach via
    SETTINGS → DATA. Check with real devices: (a) EXPORT → DOWNLOAD FILE on iOS
    Safari — does the .txt actually land in Files, or is COPY the only workable
    path? (b) blob length vs a paste through Messages/Notes — does it survive
    uncorrupted, or does something wrap/truncate it? (c) IMPORT on a second device
    → gold / unlocks / bests / codex identical? (d) the DOM overlay over the
    Phaser canvas at UI-scale extremes and in portrait — readable, tappable, no
    clipping? (e) textarea focus on iOS — does the soft keyboard shove the
    overlay off-screen? (f) import a deliberately truncated code — clear error,
    and nothing overwritten?
  - **POLISH-ENDLESS-BEST-CYCLE** — end-screen cycle line on a real device.
    Reach by winning a run, choosing CONTINUE, and surviving to cycle 1+. Check:
    (a) in **portrait** (base width is only 720 game units) does
    `ENDLESS · CYCLE 4   ·   Best 6   ·   Score 42,100` fit on one line at 16px,
    or does it need shortening/wrapping? (b) at UI-scale extremes, does it stay
    clear of the title glow above and the stats panel below? (c) does a new best
    read as a new best — gold `— NEW BEST!` with no Best number — and a
    non-record run show the true prior best?
  - **POLISH-ENDLESS-MUTATORS** — per-cycle endless mutator feel/balance
    (FEAT-ENDLESS-CYCLE-MUTATORS; pool + magnitudes in
    `src/data/EndlessMutators.ts`, roll/HUD/banner wiring in
    `GameScene.checkEndlessModeSpawns` / `syncEndlessHudLabel` /
    `showEndlessCycleBanner`, spawn hooks in `createEnemy` +
    `spawnRandomConsumable`). Reach via any endless run (first boss wave =
    cycle 1). Check with real runs: (a) banner "CYCLE N · NAME" + effect
    line legible at 48px over combat; (b) HUD top-center
    "CYCLE N · SWIFT SWARM" length vs the timer/kills stack at UI-scale
    extremes — truncation/crowding? (c) SWIFT SWARM ×1.15 trash speed on
    cycle-5+ tightened cadence — fair or frantic? (d) VOLATILE AIR 24%
    elite rate — fun density or elite soup (ring/label clutter)?
    (e) GOLD RUSH ×1.5 cache payload — noticeable in the run-end gold
    total, or lost in the noise? (f) XP SURGE ×1.25 — does the level-curve
    spike distort upgrade pacing? (g) IRON HORDE +2 trash armor vs
    late-run DPS — even noticeable? too spongy for weak builds?
    (h) refresh mid-cycle → CONTINUE: mutator effect + HUD label survive;
    a pre-feature legacy save restores as plain "CYCLE N"; (i) no-repeat
    roll across 5+ cycles — does the variety read? Knobs: meta values in
    `EndlessMutators.ts` (one bag per mutator).
  - **POLISH-ACHIEVE-ENDGAME** — endgame achievement feel/balance + retro-credit
    on a real profile. Check: (a) **retro-credit** — open ACHIEVEMENTS once on a
    profile that has already played gauntlet/endless/bosses: do the boss
    first-kills and the gauntlet/endless tiers light up and pay their gold in one
    visit (console logs `Retroactively claimed N gold`), with nothing double-paid
    on a second visit? (b) **mid-run toasts** — crossing gauntlet wave 5/10/15 or
    endless cycle 1/5/10 mid-run fires the achievement toast + gold without
    stepping on the WAVE / CYCLE banner already firing at that exact moment;
    (c) **gold scale** — 400–2,500 per tier against the existing 150–5,000
    spread: does clearing gauntlet wave 15 (2,500 + 3% damage) feel proportionate
    to victories_50 (2,000 + 5% XP), or is the endgame now the cheapest gold in
    the game? knobs = `reward.value` per entry in `AchievementDefinitions.ts`;
    (d) **tier spacing** — are wave 5/10/15 and cycle 1/5/10 the right rungs, or
    does 15 sit past where a real run dies? (e) **Paragon rate** — is paragon_25
    reachable, or effectively dead content? (f) **AchievementScene layout** — 44
    entries across 4 tabs: does scroll + 1-column portrait still read, and do the
    tab count badges fit? (g) **icon legibility** — are the 5 boss icons
    distinguishable at card size? (h) **The Legion** — kill it and confirm the
    first-kill fires on the last mote's death (the split-tree promotion path),
    not on the root.
  - **POLISH-AFFIX-PARAGON** — double-affix Paragon elites feel/balance
    (FEAT-AFFIX-PARAGON; roll + name in `src/data/Affixes.ts`
    `rollParagonAffix`/`affixDisplayName`, wiring in `GameScene.spawnBoss` /
    `spawnMiniboss` / `applyDampedAffixStats`, gold marker in
    `EliteAffixVisualManager`). Reach via endless cycle 4+ or gauntlet
    wave 10+. Check with real runs: (a) rate — 35% × 50% ≈ 17.5% of
    eligible spawns; special or spam (`PARAGON_SECOND_AFFIX_CHANCE`)?
    (b) "PARAGON SWIFT TITAN <name>" bar/banner length — truncation or
    wrap at UI-scale extremes? (c) stacked damped stats (worst pool:
    TITAN+VOLATILE ≈ 2.04× on a boss's doubled HP) — siege or drag?
    (d) SWIFT+VAMPIRIC chase heal pressure fair? (e) gold PARAGON
    ring/label reads as "bigger deal" vs single-affix color rings?
    (f) refresh mid-fight → CONTINUE: both affixes' behaviours + armor +
    gold marker survive restore; (g) twins as shared paragon pair —
    double VOLATILE corpse blasts fair?
  - **POLISH-SAVE-EXPORT-REMINDER** — backup nudge feel + thresholds on a real
    profile (`src/storage/BackupReminder.ts` holds every knob:
    `BACKUP_NUDGE_MIN_RUNS`, `BACKUP_STALE_MS`, `BACKUP_NUDGE_COOLDOWN_MS`).
    Check: (a) **trigger** — on a profile past 25 runs with no backup, does the
    prompt appear on the main menu, and is 25 runs the right rung (too early and
    it reads as spam, too late and the at-risk profile is already gone)?
    (b) **one-tap path** — BACK UP NOW → does the export panel appear with a
    valid blob, and does COPY/DOWNLOAD actually silence the prompt for 30 days?
    (c) **NOT NOW** — dismiss, then rotate the phone and re-enter the menu
    several times: does it stay gone for the full 7 days (the on-show stamp), or
    does it reappear? (d) **modal-vs-banner** — is a full-screen prompt on the
    main menu proportionate to the risk, or should it be a passive banner?
    (e) **status line** — does SETTINGS → DATA read "Never backed up …" in red
    and flip to "Backed up today." immediately after an export, without leaving
    the scene? (f) **copy tone** — does the ITP warning inform or frighten?
    (g) **import** — import a blob on a second device: does the status line read
    the blob's own export date (an old blob should still say "Backed up 40 days
    ago." and re-nudge), rather than "today"?
  - **POLISH-MINIBOSS-AFFIXES** — affixed miniboss variants feel/balance
    (FEAT-MINIBOSS-AFFIXES; tier heal in `src/data/Affixes.ts`
    `vampiricHealFraction`, wiring in `GameScene.spawnMiniboss` +
    `applyDampedAffixStats`). Reach via endless cycle 2+ or gauntlet wave 4+.
    Check with real runs: (a) 35% rate on a ~20-45s miniboss cadence — does
    endless cycle-3 (2 minibosses/wave) feel like elite soup, or right
    (`BOSS_AFFIX_CHANCE` shared with bosses; split a miniboss-specific const
    if it needs to diverge)? (b) prefixed warning banner + bar ("TITAN
    Glutton") read; elite ring/label/mini-bar on a miniboss sprite plus the
    top bar — clutter? (c) TITAN glutton (~1.7× of an already-fat pool,
    +4 armor) vs mid-run DPS: drag? (d) SWIFT charger — dash speed ×~1.3 on
    top of charge AI still dodgeable? (e) VAMPIRIC 10% middle-tier contact
    heal — noticeable without stalemate (tiers pinned in `Affixes.test.ts`)?
    (f) VOLATILE corpse blast on twins dying adjacent — double blast fair?
    (g) twins share one rolled affix (pair = one setpiece) — or should they
    roll independently? (h) refresh mid-fight → CONTINUE: prefixed miniboss
    bar, armor, speed survive restore.
  - **POLISH-BOSS-AFFIXES** — affixed boss variants feel/balance
    (FEAT-BOSS-AFFIXES, `bbad876`; roll + damping in `src/data/Affixes.ts`,
    wiring in `GameScene.spawnBoss`). Reach via endless cycle 2+ or gauntlet
    wave 6+. Check with real runs: (a) 35% rate — surprise, not the norm
    (`BOSS_AFFIX_CHANCE`)? (b) prefixed bar + entrance banner read ("VOLATILE
    Horde King"), and the elite ring/label on a boss-sized sprite isn't noise
    (ring radius = size·11+4); the floating elite mini-bar duplicates the top
    boss bar — suppress it for xpValue ≥ 1000 if it reads as clutter;
    (c) TITAN at ~1.7× HP on an already-doubled pool + 4 armor: siege or drag
    (`BOSS_AFFIX_STAT_DAMPING`)? (d) SWIFT ×1.3 speed per boss — chase still
    fair (Bastion's retreat-and-bombard especially)? (e) VAMPIRIC 5% contact
    heal — noticeable without soft-locking (ternary in the contact-collision
    block)? (f) VOLATILE instant corpse blast (95px, 22 dmg) on boss death —
    fair with the ring/label telegraph, or does it need the exploder-fuse
    treatment? (g) refresh mid-fight → CONTINUE: prefixed bar name, armor,
    and speed all survive restore; (h) gauntlet multi-boss waves: two affixed
    bosses at once readable?
  - **POLISH-BOSS-LEGION** — 5th boss "The Legion" feel/balance
    (FEAT-BOSS-MITOSIS, `d8151ec`; AI in
    `src/ecs/systems/enemy-ai/legion.ts`, split-tree/pool accounting in
    `legion-split.ts`). It's 5th in the cycle — reach via GAUNTLET or endless.
    Check with real runs: (a) **the split grammar reads** — root death visibly
    becomes 2 fragments, fragments become 2 motes each; does target-priority
    (focus one fragment vs spread damage) feel like a real decision?
    (b) **one summed health bar** — does the bar dropping smoothly across
    splits read as "one boss", and does it never jump upward? (c) **encircle
    pressure** — fragments orbit at ring 200, motes at 130, drifting
    0.35/0.55 rad/s with staggered lunges (2.1× speed, 0.85s): does the
    surround-and-pounce feel dangerous but dodgeable, or like random bumping?
    (d) **root surge** — 1.9×+0.25×/phase speed lunge every ~5.5s: telegraph
    enough without a windup ring? (e) **pool balance** — root spawns at
    2×scaled(1600) HP, pool = 3× that (≈ Bastion's effective 2×4800), armor
    8/4/0 by tier: does the fight length feel like a boss without dragging,
    and is killing 7 bodies more satisfying than one? (f) **reward timing** —
    no XP/drops until the LAST member dies (mid-tree deaths still tick
    combo/kills): does the payout-at-the-end feel earned or withheld?
    (g) **gauntlet** — legion in a multi-boss wave: wave-clear correctly waits
    for all motes (xpValue 60 threat gate); arena tint may drop early if
    another boss dies post-split (known cosmetic edge, accepted); (h) **magenta
    family** (0xdd33bb/0xee55cc/0xff77dd) vs void-purple Wyrm + red swarm at
    gameplay scale under bloom; (i) mid-fight refresh → CONTINUE: group bar
    rebuilt, split routing still pays out on the last member (module state
    rebuilt from typeIds). Tuning knobs: baseHealth/speeds/damage + armor in
    `EnemyTypes.ts`, ring radii / drift / lunge / surge constants in
    `legion.ts`, generation fractions + spawn offsets in `legion-split.ts`
    LEGION_GENERATIONS.
  - **POLISH-WEAPON-WAKE** — 19th weapon "Caustic Wake" feel/balance
    (FEAT-WEAPON-WAKE, `7e90628`; class `src/weapons/WakeWeapon.ts`, pure
    emission core in `src/weapons/wakeLogic.ts`). Check with a real run that
    picks it up: (a) **movement identity reads** — does laying a trail while
    kiting feel like a build (draw the horde through your own path), or does the
    wake just sit behind you unused? (b) **tick cadence** — per-enemy re-hit
    every 0.55s (→0.25s floor as it levels/synergizes): does standing a swarm in
    the ribbon melt it satisfyingly, or feel like a wet noodle (raise `damage` 8)
    / a free aura (raise `cooldown`)? (c) **segment geometry** — spacing 26px,
    radius 22px, lifetime 2.4s: does the ribbon read as continuous at sprint
    speed, and is wake length (speed × 2.4s) right? (d) **lane growth** — count
    2/3 (L3/L5) adds parallel ribbons at ±1.5×radius; count 4-5 widens segments
    +12% each: does the widening read as growth? (e) **4 Hz damage pass** — any
    visible hitch when a dense swarm crosses a long wake (128-segment pool, one
    spatial query per segment per pass)? (f) **Undertow mastery** (L10, 25% slow
    0.6s while inside): does slow-the-crossers read, and does it stack sanely
    with Frost Nova's slow (last-writer-wins on `Velocity.speed` — check no
    stuck-slow enemies)? (g) **Slipstream evolution** (swiftness L5: dmg ×1.45,
    range ×1.3, size ×1.2, cd ×0.85, lifetime ×1.35, brighter mint color) —
    power level vs other evolved weapons? (h) **Hit and Run synergy** with
    Homing Missiles (+20% dmg / 10% faster both) — does the kiting build read?
    (i) **acid-green visual** (0x7dff66, alpha 0.06→0.26 fading with age) —
    legible over the arena grid under bloom, and NOT confusable with green XP
    gems at gameplay scale? Tuning knobs: baseStats in `WakeWeapon` ctor, the
    constants block (`SEGMENT_SPACING`, `DAMAGE_PASS_INTERVAL`, `LANE_CAP`,
    `LANE_GAP_FACTOR`, `MASTERY_SLOW_FACTOR`, `SLOW_DURATION`,
    `EVOLVED_LIFETIME_MULT`), cooldown floor in `recalculateStats`; evolution
    multipliers in `WeaponEvolutions.ts`; synergy magnitude in
    `WeaponSynergies.ts`.
  - **POLISH-WEAPON-GUARDIAN** — 18th weapon "Guardian" feel/balance
    (FEAT-WEAPON-GUARDIAN, `e4fcb27`; class `src/weapons/GuardianWeapon.ts`, pure
    trigger/damage core in `src/weapons/guardianLogic.ts`). Check with a real run
    that picks it up: (a) **reactive trigger reads** — when you take a hit, does
    the amber nova visibly erupt from you and does it feel *caused by* the hit
    (not a random cooldown pop)? (b) **swarm chain-detonation guard** — base
    internal cooldown 1.5s (→0.9s min as it levels): in a dense swarm that hits
    you repeatedly, does the orb retaliate at a satisfying cadence, or does it
    feel starved (raise) / spammy (lower)? knob = `cooldown` in the ctor +
    ramp in `recalculateStats`. (c) **hit-scaled payoff** — shard damage is base
    16 + 60% of the hit taken, capped at +1.5× base (`HIT_FRACTION` /
    `MAX_BONUS_MULTIPLE` in the class, formula in `guardianLogic`): does
    face-tanking a big blow visibly fire back harder, and is the cap right (a
    boss slam shouldn't nuke the screen)? (d) **radial nova reads** — base 8
    shards (+1 every 2 levels), speed 460, reach `SHARD_MAX_TRAVEL` 300, piercing
    2, knockback 90: does the ring clear space around you after a hit (defensive
    payoff), or scatter enemies you wanted clumped? (e) **face-tank identity** —
    does pairing it with armor/thorns/HP actually feel like a distinct
    aggressive build vs the kiting weapons? (f) **Bulwark mastery** (L10) grants
    0.5s of i-frames per retaliation (`MASTERY_INVULN`; extends `damageCooldown`
    in `GameScene.takeDamage`) — does the brief post-hit invuln feel like a real
    survivability payoff without trivializing damage? (g) **Aegis evolution**
    (reach vitality L5): wider (×1.4 size) + harder (×1.5 dmg) nova, shards
    knock back 200 and briefly freeze (250ms) what they hit — power level vs
    other evolved weapons; does the freeze-the-swarm-on-retaliation read as a
    defensive "shield" or as noise? (h) **Riposte synergy** with Katana
    (+20% dmg / 10% faster both) — does the brawler build read? (i) amber orb +
    shockwave-ring burst visual at gameplay scale under bloom; brighter cyan
    Aegis form legible? Tuning knobs: baseStats in `GuardianWeapon` ctor, the
    constants block (`SHARD_SPEED`, `SHARD_MAX_TRAVEL`, `HIT_FRACTION`,
    `MAX_BONUS_MULTIPLE`, `SHARD_KNOCKBACK`, `EVOLVED_KNOCKBACK`, `EVOLVED_STUN`,
    `MASTERY_INVULN`), cooldown ramp in `recalculateStats`; evolution multipliers
    in `WeaponEvolutions.ts`; synergy magnitude in `WeaponSynergies.ts`.
  - **POLISH-WEAPON-SINGULARITY** — 17th weapon "Singularity" feel/balance
    (FEAT-WEAPON-SINGULARITY; class `src/weapons/SingularityWeapon.ts`, pure
    lifecycle + pull math in `src/weapons/singularityLogic.ts`). Check with a
    real run that picks it up: (a) **the clump reads** — does the well visibly
    yank the swarm into a knot, and does that knot make your OTHER weapons
    (meteor/aura/spikes) obviously land harder? That amplification is the whole
    point; if the pull is too weak to matter, raise `PULL_STRENGTH` (300) or
    `MAX_TUG_PER_FRAME` (6). (b) **tug not teleport** — enemies should slide in
    smoothly, never snap; if it snaps at low FPS, lower `MAX_TUG_PER_FRAME`.
    (c) **lob cadence + count** — base cooldown 4.5s (→2.6s min as it levels),
    travel 0.35s, pull 1.6s, +1 well every 2 levels (pool cap 6): does a field
    of wells at high level feel like escalating control or spammy? (d) **collapse
    payoff** — base dmg 34 with distance falloff + 140 knockback: does the burst
    feel worth the wind-up, or does the knockback scatter the clump before your
    other weapons cash in on it? (e) **boss/miniboss resist** — bosses are
    pull-immune, minibosses at 30% (`MINIBOSS_PULL_RESIST`): does anchoring the
    trash while a boss ignores the well feel right, or should minibosses resist
    more/less? (f) **Event Horizon mastery** (L10) drops a lingering `void`
    hazard field (3s) on collapse — does sustained post-collapse clumping read,
    or clutter the arena? (g) **Black Hole evolution** (reach L5): wider well
    (size ×1.35) + damage-over-time for the whole pull (`DOT_FRACTION` 0.3 per
    0.35s) + dmg ×1.4 — power level vs other evolved weapons? (h) **Gravity
    Collapse synergy** with Meteor (+25% dmg both) — does the "drop a rock on the
    clump" combo read? (i) violet accretion-spiral + influence-ring visual at
    gameplay scale under bloom; brighter pink for the evolved form legible?
    Tuning knobs: baseStats in `SingularityWeapon` ctor, the constants block
    (`PULL_RADIUS_BASE` 150, `PULL_STRENGTH`, `MAX_TUG_PER_FRAME`, `TRAVEL_TIME`
    0.35, `COLLAPSE_KNOCKBACK` 140, `LINGER_DURATION` 3, `WELL_POOL_SIZE` 6),
    cooldown ramp in `recalculateStats`; evolution multipliers in
    `WeaponEvolutions.ts`; synergy magnitude in `WeaponSynergies.ts`.
  - **POLISH-WEAPON-SENTRY** — 16th weapon "Sentry Turret" feel/balance
    (FEAT-WEAPON-SENTRY, `58901ef`; class `src/weapons/SentryWeapon.ts`, pure
    lifecycle in `src/weapons/sentryLogic.ts`). Check with a real run that picks
    it up: (a) **deploy cadence + uptime** — base deploy every 3.5s (→1.6s min
    as it levels), turret lives 6s, fires every 0.5s: does a single turret feel
    like meaningful sustained coverage, and does the first turret dropping ~0.5s
    in (not a full cooldown later) read as responsive at run start? (b) **gun-
    line build** — max concurrent turrets = count (1 → +1 every 2 levels, cap 8
    slots); does accumulating a field of turrets as you level feel like the
    intended positional identity, and does retire-oldest cull the right turret?
    (c) **stationary trade-off** — a turret fires where it stands while you kite;
    is anchoring a chokepoint then leading enemies through the fire satisfying,
    or do turrets mostly sit out of the fight because the swarm follows you away?
    (d) **targeting** — each turret auto-aims the nearest enemy in range (240)
    via SpatialHash; barrel tracks the target, idle-sweeps with none — legible?
    (e) **bolt readability** — cyan piercing bolts (piercing 1 = hits 2) over the
    projectile swarm + bloom; muzzle flash per shot (1 circle+tween, ~10/s at a
    full line) — juice or noise/FPS at high turret counts? (f) **Overclock Array
    mastery** (L10) drops TWO flanking turrets per deploy — does the doubled
    build rate feel like a payoff without the 8-slot pool thrashing? (g) **Rail
    Sentry evolution** (piercing L5) — bright rail lances (piercing +3, range
    ×1.3, dmg ×1.6): power level vs other evolved weapons; (h) **Automated
    Arsenal synergy** with Combat Drone (+20% dmg / 10% faster to both) — does
    the autonomous-summon build read? (i) hex-mount + barrel + deploy-ping visual
    at gameplay scale under bloom; fade-near-expiry conveys remaining uptime?
    Tuning knobs: baseStats in `SentryWeapon` ctor, `FIRE_INTERVAL` (0.5),
    `SENTRY_POOL_SIZE` (8), `PROJECTILE_MAX_TRAVEL` (900), the cooldown ramp in
    `recalculateStats`; evolution multipliers in `WeaponEvolutions.ts`; synergy
    magnitude in `WeaponSynergies.ts`.
  - **POLISH-BOSS-BASTION** — 4th boss "The Bastion" feel/balance
    (FEAT-BOSS-BASTION, `37297d1`; AI in `src/ecs/systems/enemy-ai/bastion.ts`,
    strike planning + all knobs in `bastion-barrage.ts`). Check with real
    runs (it's 4th in the cycle — fastest to reach via GAUNTLET wave 3+ or
    endless): (a) siege identity — does the retreat-and-bombard loop read as
    "corner the artillery" or as tedious chasing? Reviewer confirmed the
    screen-bounds clamp pins it at walls, so cornering IS the counterplay;
    (b) mortar dodge feel — scatter fuses 1.2/1.05/0.9s by phase, ring band
    70–170 around you, blast 70: fair pressure or bullet-hell noise over the
    trash stream? (c) rolling barrage (phase 2+, 45%) — does the marching
    strike line telegraph "move sideways" clearly? (d) orange mortar rings
    (0xff7733, 78px) vs red boss AOE rings — distinguishable mid-swarm?
    (e) fortress silhouette + burnt-bronze palette at gameplay scale under
    bloom, muzzle facing the player; (f) armor 14 (vs 12 other bosses) +
    4800 HP — does the fight length feel "siege" without dragging?
    (g) frame rate during barrages — each shell fires the unpooled
    handleGroundSlam visual (circle + graphics + 2 tweens × 3–7 shells);
    reviewer flagged the allocation rate — if it stutters, pool the mortar
    impact visual; (h) burn-crater arena hazards near the player every ~5s —
    pressure or clutter? Knobs: PREFERRED_RANGE/RANGE_SLACK + reload
    (4.2−0.5·phase) in `bastion.ts`; counts/fuses/damage/radii in
    `bastion-barrage.ts`; armor in `EnemyTypes.ts` ENEMY_ARMOR.
  - **POLISH-DAILY-RESTORE** — daily/weekly refresh recovery
    (BUG-DAILY-MODE-RESTORE fix, `5d50c79`). Check: start a daily, refresh
    mid-run, CONTINUE, die → LEADERBOARD shows the day's entry; PLAY AGAIN
    from that death relaunches the same challenge (same modifiers/ship/weapon
    — the config regenerates from the date) and a second, better run replaces
    the day's entry (best-of-day).
  - **POLISH-RUN-IDENTITY-RESTORE** — run launch identity across refresh
    (BUG-SHIP-ID-NOT-SAVED fix, `cf38937`). Check: pick a non-default ship
    (distinct hull, e.g. Boss Hunter) + non-default weapon + a pact, refresh
    mid-run, CONTINUE → the restored run renders THAT ship's hull family +
    neon color (not the default arrow); die → PLAY AGAIN relaunches with the
    same ship/weapon/pacts AND the same run modifiers (previously: default
    ship, re-rolled modifiers); same flow in a GAUNTLET run keeps mode +
    identity together. Legacy saves (pre-fix) restore as before — default
    ship, no pacts.
  - **POLISH-GAUNTLET** — GAUNTLET boss-rush mode feel/balance (FEAT-GAUNTLET;
    wave math in `src/game/gauntlet/gauntletWaves.ts`, loop in
    `GameScene.updateGauntletMode`). Check with real runs: (a) pacing — 8s
    intro, 5s breather, miniboss 1.5s / boss 4.5s spawn staggers; do waves
    flow or drag? (b) escalation — composition table (1mb / 2mb / boss / …,
    caps 3 bosses + 6 minibosses) + per-wave stat ramp (×1.12 HP / ×1.08 dmg
    / ×1.06 XP from wave 2) vs the player's level curve off trash XP: find
    the wall wave, is it satisfying? (c) wave-clear rewards — gold
    (25 + 15·wave) + 2 health pickups: enough to sustain, or trivializing?
    (d) multi-boss waves (6+) — 2-3 bosses + the trash stream at once:
    readable? frame rate? boss health-bar stack? (e) HUD "GAUNTLET · WAVE N"
    label + WAVE banners legible mid-combat, clear banner not lost in the
    fight; (f) death screen "GAUNTLET · WAVE N (Best M / NEW BEST!)" line
    reads right, no score/grade/recent-strip remnants; (g) GAUNTLET deck
    card on the main menu — 7-card portrait row shrink-to-fit still
    readable, confirmation-on-existing-save flow sane; (h) mid-run refresh →
    CONTINUE resumes the wave (or re-queues it if the save caught the spawn
    stagger); PLAY AGAIN after death restarts gauntlet (same stage; ship /
    weapon / pacts persist too since the BUG-SHIP-ID-NOT-SAVED fix,
    `cf38937`). Tuning knobs: all
    constants in `gauntletWaves.ts`, heal amount (20×2) in
    `completeGauntletWave`.
  - **POLISH-SHIP-HULLS** — per-ship hull families × 10 evolution tiers
    (`src/visual/shipHullGeometry.ts`, wired via `ShipCharacter.hullId` →
    `PlayerSpaceship`; ship-select hangar `ShipPreview` cycles each ship's
    real hull through all 10 tiers). Check in real runs: (a) each of the 11
    silhouettes reads at gameplay scale/rotation under bloom (esp. Boss
    Hunter's long barrel and Juggernaut's twin-prong ram), (b) the 10
    evolution transitions per ship (levels 1,4,7,11,15,19,23,27,31,35) feel
    like growth, not a ship swap, and the faster evolution cadence isn't
    callout spam, (c) thrust flames sit right on the per-ship nozzle layouts
    (Dreadnought/Juggernaut multi-engine rows), (d) the hangar preview cycling
    all 10 tiers reads well for every hull at both preview scales,
    (e) danger/combo hull-color shifts still read on darker hull fills.
    Tuning knobs: outline coords per builder + `TIER_SCALE` in
    `shipHullGeometry.ts`.
  - **BALANCE-SHIP-MODS** — per-ship mod track economy (FEAT-SHIP-MODS-1;
    spec: `docs/superpowers/specs/2026-07-03-ship-mod-tracks-design.md`).
    First-pass numbers shipped without human sign-off (operator asked for the
    feature directly): every track 3 levels at 400/700/1200 gold (6,900 per
    ship, ~76k full fleet), per-level magnitudes in the spec's archetype
    table (+2-4% mults, +1 armor, +0.2 HP/s, etc.). Check with real play:
    (a) does maxing your main ship's 3 tracks feel meaningful but not
    mandatory (~a mid shop tier)? (b) is the fleet-wide sink priced right
    against the scanner (500/roll) and deep shop tracks? (c) HANGAR tab
    usability — card readability, purchase flow, level pips, MAXED state,
    tab row fit at portrait width; (d) identity check — do the assigned
    archetypes actually reinforce how each ship plays? Knobs: costs array
    in `src/data/ShipMods.ts` tracks, effectPerLevel values, per-ship
    track assignment.
  - **POLISH-PORTRAIT** — portrait mode support (FEAT-PORTRAIT). The base game
    size is now orientation-aware (1280×720 landscape / 720×1280 portrait,
    `src/utils/Orientation.ts` + watcher in `main.ts`); menus restart on flips,
    GameScene does the UI-scale save-restore round trip (resumes into pause).
    **Needs a real phone, BOTH orientations, and live rotations:** (a) rotate
    on the main menu / shop / codex / achievements / cards / weapon select /
    pact select / leaderboard / settings / music / credits — every scene
    re-lays-out, nothing overflows or overlaps, gamepad/keyboard nav still
    tracks the visual grid (columns change in portrait); (b) rotate MID-RUN —
    brief restart, pause menu reopens, run state intact, HUD/minimap/touch
    buttons correctly placed for the new orientation; (c) rotate while the
    level-up modal is open — modal stays usable, relayout settles after the
    last queued selection; (d) rotate on death/victory screens — cosmetic
    only (by design, no relayout; run-over states can't save-restore);
    (e) portrait death screen: WEAPON DAMAGE + PERSONAL BESTS sit side by
    side BELOW the stat column (recent-runs strip is hidden in portrait —
    follow-up); (f) portrait pause: BUILD STATS + RUN MODIFIERS below the
    buttons — check the tallest build (6 weapons + 4 synergies) for bottom
    clipping at exactly 720×1280; (g) portrait CARD ARCHIVE: 4-col grid +
    compact scanner bar, decrypt flow + reveal; (h) verify
    `scale.setGameSize` under EXPAND actually re-bases on rotation on iOS
    Safari (blind-implemented — cannot be runtime-verified in the sandbox);
    (i) iOS toolbar show/hide and keyboard must NOT trigger spurious scene
    restarts (250ms debounce + orientation-class comparison should absorb
    them). Known v1 cuts: victory card-reveal panel may graze the stats
    panel edge in portrait; SettingsScene content clusters at the top
    (fits, just sparse); Codex margins run 13px.
  - **POLISH-CARDS** — card collection + scanner lottery (FEAT-CARDS-1; spec in
    `docs/superpowers/specs/2026-07-03-card-collection-meta-design.md`, feel
    checklist at the bottom). Check: (a) CARD ARCHIVE grid legibility — '?'
    slots vs discovered mini-cards, rarity hairlines at 40% blend, detail line
    on hover/focus, full keyboard/gamepad walk; (b) DECRYPT flow — gold spend,
    pity countdown ("EPIC+ GUARANTEED IN N"), reveal flip + glow + evolution
    flourish sfx (and the reduced-motion fade), ARCHIVE COMPLETE end state;
    (c) in-run cache drops — boss 100% / miniboss 20% / elite 2% cadence feels
    right, pickup toast reads, once-per-run guard holds, and a cache from an
    ABANDONED run stays hidden ('?' slot, bonus inactive) until the next
    end-screen reveal (FEAT-CARDS-2 deferred discovery); (d) end-screen reveal
    panel placement + discovery chime timing on BOTH death and victory at
    UI-scale extremes and phone landscape; (e) bonuses small enough that a
    full archive ≈ one shop tier — the idle detail line shows the live
    ARCHIVE BONUS aggregate (magnitudes in `src/data/Cards.ts`); (f) Surge
    Array: Overdrive meter visibly fills ~10% faster; (g) collection
    milestones (1/6/12/24 cards → gold) — banner + chime on unlock from a
    decrypt, toast when a tier crosses on an end-screen reveal, retro-credit
    on first CARD ARCHIVE visit for pre-milestone collections. Balance knobs:
    SCAN_COST/PITY_THRESHOLD (`CardCollectionManager.ts`), cache chances
    (`GameScene.handleEnemyDeath`), milestone gold
    (`AchievementDefinitions.ts` `cards_discovered_*`).
  - **POLISH-SETTINGS-UX** — sliding-switch toggles (`03716d2`) + mid-run UI-scale
    apply (`3ebb815`). Check: (a) switches read instantly (green/right = on) at every
    UI scale, knob slide is clean, gamepad focus ring visible; (b) mid-run UI-scale
    change round-trips save-restore correctly — adjust from pause → settings → back:
    brief restart, pause menu reopens, HUD/minimap/touch controls resized, and the
    run state (kills, level, boss bars, weapon levels, relics, combo) is intact;
    (c) same flow during endless-after-victory keeps won/endless state.
  - **POLISH-10PACK** — ten-feature visual polish drop (scene sweep transitions +
    staggered menu entrances, button press micro-interaction, reduced-motion gating
    across menus, HUD bar juice [damage chip / gradients / XP pulse / ult ready
    sweep], victory-screen parity with the death screen, Rajdhani damage-number
    tiers, boss letterbox intro, minimap glass framing, HTML boot loader). Check:
    (a) menu nav transitions never strand a black overlay on rapid double-clicks or
    gamepad spam; (b) entrance stagger doesn't fight keyboard/gamepad focus on
    Shop/Codex/Achievements; (c) HP damage chip reads under rapid multi-hits and
    heals; (d) ult ready sweep + glow aren't noise mid-swarm; (e) boss letterbox is
    legible over arena tint and cleans up if you die during it; (f) crit damage
    numbers pop without overwhelming; (g) victory stats panel at UI-scale extremes;
    (h) boot loader hands off smoothly (no flash of black) on slow connections;
    (i) reduced-motion: menus static but fully readable, no missing state. Known
    minor edge (agent-flagged): disabling a MenuButton while a pointer is held
    leaves it at pressed scale until re-enabled — no current call site does this.
  - **POLISH-MOBILE-IPHONE** — mobile/Safari polish pass (multitouch
    `activePointers: 4`, safe-area container via fixed insets, portrait rotate
    overlay, iOS lifecycle saves on pagehide/visibilitychange, AudioContext
    foreground resume, density-compensated HUD/menu/joystick scaling, death-screen
    stats panel). Check on an iPhone (16 Pro Max especially), Safari landscape:
    (a) dash/ult taps register while the joystick thumb is down; (b) nothing renders
    under the Dynamic Island or home indicator, no black-bar mismatch; (c) HUD/menu
    text physical size feels right with the toolbar shown vs hidden (minimal UI);
    (d) pull-to-refresh, pinch zoom, double-tap zoom, long-press callout all inert;
    (e) kill the tab mid-run → save restores; take a phone call mid-run → music
    resumes; (f) death screen: grade badge clear of the title, stat numbers flush
    right in their cells, unlock panel + afford teaser + tap-to-restart all visible
    above the bottom edge; (g) portrait shows the rotate overlay, rotating back
    resumes cleanly.
  - **POLISH-SLEEK-REDESIGN** — sleek neon-tech visual pass (branch
    `claude/game-design-visual-polish-q134lf`): Rajdhani display font replaces the
    sticker look (comic fonts dropped from `index.html`), cards flattened (no
    tilt/wobble), sharper corners + centered soft shadows, thin hairline accents,
    light-streak menu backdrop replaces playing-card drifters, BootScene wordmark
    restyled (flat, accent underline, glow breathe). Check: (a) Rajdhani legibility at
    small banner sizes (14px) and on phones; (b) HUD label contrast over dense combat
    with the thinner strokes; (c) BootScene title/underline spacing at UI-scale
    extremes; (d) hover glow + rim flecks still read well on the sharper 6px-radius
    cards; (e) touch-button shadow (now centered, softer) still separates from the
    arena background.
  - **POLISH-MOBILE-ROUND2** — operator's phone-feedback fixes (2026-07-03
    evening screenshots). Check on the phone, both orientations: (a) portrait
    MAIN MENU now renders the column FULL SIZE, vertically centered (was 56%
    and stranded top-third) — title inside the width incl. its glow, nothing
    overflowing the challenge cards, deck readable; (b) FORGE A PACT —
    selection is a uniform thick green border + "✓ SELECTED" badge + tinted
    fill (pact colors stay on names only), thin WHITE ring = keyboard focus
    only (taps no longer strand it), live "N/3 PACTS SELECTED" counter,
    red MAX flash at the cap, and deselecting back to zero visibly works;
    (c) in-run BOUNTY line now sits BELOW the big timer, density-scaled +
    stroked — readable in portrait during combat; (d) SHIP PREVIEW on the
    ship-select step: real hull cycling all 5 evolution tiers with tier name
    caption — beside the grid in landscape, above it in portrait (hidden on
    short portrait viewports with 3+ card rows), follows keyboard/mouse
    focus, no ghosting between ships (texture-key collision fixed).
    Round 2b (same evening, more screenshots): (e) portrait VICTORY — card
    reveal now centered BELOW the buttons (it sat on the stats panel,
    covering the Level cell); portrait GAME OVER — reveal takes the right
    below-column slot and PERSONAL BESTS yields when a card was found;
    (f) portrait HUD — HP/XP/ULT bars trimmed (180→120 base units) so the
    centered timer clears the bar labels; (g) SETTINGS portrait — full-size
    single-column stack (AUDIO→COMBAT→VISUALS→DATA), fixes the clipped
    colorblind/damage-number pills; (h) SHOP — tab strip reserve widened so
    the HANGAR pill + count badge stay on-screen at 720, and the buy/refund
    row no longer overlaps by 8px on leveled cards (all widths).
  - **POLISH-MENU-NAV** — keyboard/gamepad nav on the newly wired scenes (`abf7c58`).
    Check with a controller: (a) PactSelect — selection/focus treatment reworked in
    POLISH-MOBILE-ROUND2 (uniform green selected + white focus ring); check the
    B = skip-pacts-and-begin feel (it's not "back"), (b)
    Achievement — d-pad down moves one visual card row at a time and scroll follows
    focus, (c) MusicSettings — held d-pad walks the 26-track list at a comfortable rate
    (200ms repeat), (d) Settings — stick/d-pad left/right volume-adjust speed; segmented
    pills (playback/damage numbers/colorblind) step one option per press; reset-confirm
    dialog fully drivable by pad (left/right + A/B).
  - **POLISH-TUTORIAL-HINTS** — one-time contextual hints (`7036e29`; defs in
    `src/tutorial/TutorialHints.ts`). Check: (a) dash-danger toast lands at a readable
    moment (fires on first damage with dash ready — mid-swarm it may be missed), (b)
    first-miniboss toast + warning banner together aren't noise, (c) touch wording shows
    on actual phones, (d) evolution-progress toast doesn't stack awkwardly over the
    upgrade-modal close. To re-test as a new player: clear `survivor-tutorial-hints`.
  - **POLISH-TELEGRAPH-BOSSES** — new windup telegraphs (`4f18ac4`; specs in
    `src/ecs/systems/enemy-ai/telegraphs.ts`). Check: (a) The Machine's 3-beam laser grid
    (800px lines, 1.5s) isn't visual noise over its bullet spam, (b) Void Wyrm sweep lane
    matches where the sweep actually goes (target stored 1 frame after telegraph), (c)
    Horde King ring legibility against the red arena tint, (d) telegraph pool (32) holds
    up in dense Dasher/Zigzag waves with a boss active.
  - **BALANCE-ULTIMATE** — new Overdrive ultimate (`895c4be`+`cd18cd9`). Check with a
    real run: (a) charge cadence — does the meter fill at a satisfying rate (~40 kills
    or ~8.3k damage)? rates are `ULTIMATE_CHARGE_PER_KILL`/`_PER_DAMAGE` in
    `UltimateSystem.ts`; (b) nova power vs the BOMB consumable (ult scales with player
    damage, bomb doesn't) — too weak early / too strong late? (`computeUltimateNova`);
    (c) HUD gold bar legibility below the XP bar + the ready pulse/glow not being noise;
    (d) mobile: gold button placement above dash, no joystick-spawn conflict, dim→bright
    fill readable; (e) slow-time window (900ms/0.2) feel on activation; (f) the
    `ultimate-ready` hint timing (fires the first time it charges).
  - **BALANCE-UPGRADE-RARITY** — rarity-tiered level-up offers (`ea51123`;
    `UPGRADE_LUCK_RARITY_BONUS` in `src/data/UpgradeRarity.ts`, assignments in
    `Upgrades.ts`). Check: (a) luck-bias strength feels right at realistic max luck
    (~0.6 → epic weighs 1.9× a common), (b) epic purple card vs weapon-level-up magenta
    card legibility on the same modal, (c) the rarity tag (`halfH - 44`) doesn't collide
    with the gate-warning text on tall cards.
  - **BALANCE-LUCK-DROPS** — luck → relic-rarity bias strength (`2a094e0`;
    `LUCK_RARITY_WEIGHT_BONUS` in `src/data/Relics.ts`). At realistic max luck (~0.6)
    legendary share ~3×'s — confirm noticeable-but-not-broken.
  - **POLISH-MINIMAP-PLACEMENT** — tactical radar placement + feel (`7efc392`;
    `MinimapManager.ts` anchors mid-right via `BASE_RADAR_RADIUS`/`BASE_EDGE_PADDING`;
    feed in `GameScene.updateMinimap`). Check on real devices: (a) the mid-right disc
    doesn't collide with the relic strip / boss health panel at UI-scale extremes
    (0.5–2.0) or on phones; (b) blip legibility — boss/miniboss/elite vs the red
    enemy swarm against the arena tint + bloom; (c) the rotating sweep reads as radar
    not noise (off under reduced motion); (d) the 48-blip enemy cap conveys density
    convincingly in 1000+ enemy endless waves without lag; (e) chest + consumable gold
    blips are distinguishable from threats. Tuning knobs: `MINIMAP_WORLD_RANGE` (radar
    zoom), `MINIMAP_MAX_ENEMY_BLIPS`, blip colors/sizes in `minimapProjection.ts`.
  - **POLISH-WEAPON-BOOMERANG** — new Boomerang Glaive weapon feel/balance
    (FEAT-WEAPON-BOOMERANG; `src/weapons/BoomerangWeapon.ts` + pure
    `src/weapons/boomerangMotion.ts`). Check with a real run that picks it up: (a)
    **throw cadence + reach** — base damage 17 / cooldown 1.4s / range 280 / piercing 2;
    does the out-and-back arc feel satisfying and is the apex (== `range`) where you'd
    expect? (b) **return-catch reliability** while moving fast — the glaive homes to your
    *current* position at 1.2× outbound speed; does it visibly chase and catch you, or
    lag awkwardly when you sprint away? (c) **both-legs damage** reads — an enemy in the
    lane should take an out-hit and a return-hit (0.35s per-enemy re-hit cooldown,
    capped at `piercing` total); is the double-tap legible? (d) **spinning-glaive
    visual** — crossed cyan blades brighten (0xbbeeff) on the return leg; readable over
    bloom + the projectile swarm, or noise? (e) **Twin Glaives mastery** (L10) fires a
    mirrored volley behind you — does the 32-glaive pool hold up with high count +
    mastery in dense waves? (f) **Eclipse Glaive evolution** (`reach` L5) power level
    vs other evolved weapons; (g) **Rebound Theory** synergy with ricochet magnitude.
    Tuning knobs: baseStats in `BoomerangWeapon` ctor, `RETURN_SPEED_FACTOR` (1.2),
    `CATCH_RADIUS` (22), `HIT_COOLDOWN` (0.35), `POOL_SIZE` (32); evolution multipliers
    in `WeaponEvolutions.ts`; synergy in `WeaponSynergies.ts`.
  - **POLISH-UPGRADE-LOCK** — level-up card lock feel (FEAT-UPGRADE-LOCK;
    `UpgradeScene.createLockToggle`/`drawPadlock`/`toggleLockForUpgrade`, pure core
    `src/data/upgradeLocks.ts`). Check with a real run that has rerolls available: (a) the
    **gold padlock pip** (top-right of each card) reads as locked-vs-unlocked at UI-scale
    extremes and over the rarity/mastery card colors — and the drawn shackle arc actually
    looks like a padlock (screen-y-down arc direction is reasoned, not eyeballed); (b) the
    **front-pin reorder** — locked cards jump to the front on reroll; does that feel right
    or should locked cards hold their slot? (c) clicking the pip never also selects the
    card (topOnly + stopPropagation) on touch + mouse; (d) `[L]` toggles the
    keyboard-focused card and gamepad **West/✗** toggles the focused card (new
    `MenuNavigator.onSecondary`) — no conflict with select(A)/cancel(B); (e) the hint line
    (`buttonY − 40`) doesn't crowd the bottom row in 5–6-card (two-row) layouts; (f) with
    `rerollsRemaining` hitting 0 after the last reroll, pinned cards show with no pip —
    confusing or fine? Tuning: pip radius/position in `createLockToggle`, padlock geometry
    in `drawPadlock`, `lockCapacity` (= count−1).
  - **POLISH-SYNERGY-VISIBILITY** — synergy toast + pause-dashboard surfacing
    (FEAT-SYNERGY-VISIBILITY; `GameScene.showSynergyToast`, `formatSynergyBonus` +
    `createBuildStatsPanel` in `PauseMenuManager.ts`). Check with a real run that
    equips a synergy pair: (a) the `⚡ <name>` activation toast lands at a readable
    moment when a pickup/level completes a pair (and isn't lost under the upgrade
    modal that's open when a weapon is chosen); (b) the ACTIVE SYNERGIES rows on the
    pause BUILD STATS panel don't overflow the 220px panel for the longest synergy
    names + `+x% dmg  +y% spd` values at UI-scale extremes; (c) with a 6-weapon build
    hitting 3–4 synergies, the panel (capped at 4 synergy rows + 5 weapon rows) stays
    on-screen below the stat rows. Tuning: toast color `0x66ddff`/duration 3200, the
    `.slice(0, 4)` synergy cap, bonus format in `formatSynergyBonus`.
  - **POLISH-SHIP-TOUCH-SELECT** — ship-card hover preview + press/release commit
    (`WeaponSelectScene.renderShipSelectionStep`), extended to stage + weapon cards
    and the RANDOM button by POLISH-TOUCH-PRESS-RELEASE (`abb7e3e`). Check: (a)
    desktop hover sweeps across cards swap the hangar preview instantly with no
    hull-rebuild hitch (setShip now dedupes by ship id); (b) touch on a real phone,
    ALL THREE steps: press highlights the card (ship step also previews the hull),
    drag-off-and-release cancels without committing, release-on-card commits; RANDOM
    now fires on release like every other button; (c) hover syncing MenuNavigator
    focus doesn't fight gamepad navigation when both are used in the same session;
    (d) the down+up double click sound on a committing tap isn't grating on phone
    speakers (mirrors the shipped ship-card behavior).
  - **POLISH-DAILY-SCORE-COL** — leaderboard SCORE column + Boot chip width (`45fdd74`;
    `LeaderboardScene.renderEntries` row 720→800, `BootScene.ts:~795`). Check crowding at
    UI-scale extremes.
  - **POLISH-RUN-HISTORY** — "RECENT" strip placement on end overlays
    (`PauseMenuManager.createRecentRunsStrip`, x=28). Check overlap/contrast.
  - **POLISH-RUNNER** — scroll-runner feel: zigzag dart cadence, telegraph readability,
    parallax drift (`GRID_DRIFT_AMPLITUDE` in `GridBackground.ts`,
    `ParallaxBackground.ts`), FPS at high counts.
  - **BALANCE-1** — range/speed rebaseline side effects (reactivated slow-projectile
    debuff + +5% range relic; `RunModifiers.ts`, `Relics.ts`).
  - **BALANCE-2** — power-curve mismatch (multiplicative player damage vs +15%/level
    enemy HP; Katana/Aura hot, Homing Missiles cold). Holistic pass with real runs.
  - **BALANCE-3** — enemy armor values (`ENEMY_ARMOR` in `EnemyTypes.ts`, applied in
    `WeaponManager.damageEnemy`).
  - **BALANCE-4** — player movement momentum (`PLAYER_ACCEL_BASE` in `InputSystem.ts`,
    currently 30; also Sprint/Battle Flow magnitudes).
  - **BALANCE-5** — top-10 feature tuning (consumable drop rates, affix roll chance,
    Limit Break per-level bonuses, destructible/shrine/bounty cadence, pact
    difficulty-vs-reward, music intensity range, grade thresholds).
  - **POLISH-PWA-OFFLINE** — install + offline on a real device. Reach by
    opening the deployed site on an iPhone. Check: (a) Share → Add to Home
    Screen — is the icon the parallelogram (not a page screenshot) and the
    name "Survivor"? (b) launch from the home screen — standalone, no Safari
    chrome, safe-area insets still correct in both orientations? (c) launch
    once online, then **airplane mode** → launch again: does a full run
    complete, with sfx and icons? (d) music offline — a track played while
    online replays in airplane mode; an unplayed one fails gracefully without
    raising the crash overlay (`unhandledrejection` already only logs). (e)
    fonts — does the boot wordmark still render in Rajdhani, and menus in
    Atkinson, with no flash of Arial? (f) after the *next* deploy, does an
    online launch pick up the new build on the first (not second) launch?
    (g) storage — Settings → Safari → Advanced → Website Data: is the site's
    footprint sane (~3 MB shell + up to 2.1 MB music)?
    Kill switch if any of this goes wrong: `PWA_KILL=1 npm run build` and
    deploy — it unregisters the worker and drops every cache within 24h.

  - **POLISH-DAILY-SHARE** — share text + button on a real device. Reach by
    playing a DAILY or WEEKLY from the main menu to a death (or a win →
    the victory overlay). Check: (a) **iOS Safari clipboard** — does COPY
    RESULT actually reach the clipboard from a Phaser canvas tap, or does the
    label read COPY FAILED (`navigator.clipboard.writeText` needs a secure
    context + a real user gesture; `src/utils/Clipboard.ts` falls back to
    `execCommand`)? (b) **paste fidelity** — paste into Messages/Notes: do the
    `—` and `·` separators survive, and does the URL autolink? (c) **the tap
    does not restart** — the game-over screen restarts on a tap anywhere;
    confirm COPY RESULT copies WITHOUT restarting the run (the
    `stopPropagation` guard), and that a tap just outside it still restarts.
    (d) **victory placement** — the button sits in a ~79px band between the
    streak line and the Continue/Next World row; at UI-scale extremes and in
    portrait, does it crowd either? (e) **victory teardown** — tap COPY RESULT,
    then CONTINUE: does the pill vanish cleanly, and does the 2s COPIED! revert
    fire on a destroyed label (should be silently skipped)? (f) **short
    landscape** — on a short viewport the restart hint clamps to
    `height - 24` while the button adds ~58px to the stack; does the hint ever
    collide with the pill? (pre-existing clamp weakness, now under more
    pressure). (g) **is the result worth sharing** — does the 4-line text read
    as a brag, or should it carry kills/level too? Knobs: the line templates in
    `src/meta/DailyShare.ts`.

  - **POLISH-PWA-INSTALL-PROMPT** — the install hint on real devices (agents
    cannot see a Share sheet or a Chrome install dialog). Reach it: a profile
    with >=3 completed runs, opened in a browser tab (not an installed app),
    that has never seen the hint — clear `survivor-install-hint-at` from
    localStorage to re-arm. Check: (a) **iOS Safari** — do the two drawn steps
    match what the current iOS actually shows, and does the Share glyph read as
    the Share glyph at 18px? (b) **Android Chrome** — does INSTALL open the real
    install dialog, and does the hint appear at all (it waits on
    `beforeinstallprompt`, which Chrome may fire late or never if its own
    engagement heuristic is unmet)? (c) **desktop Chrome** — same, and does the
    panel look right at 420px on a wide window? (d) does it correctly *never*
    show inside the installed app (launch from the home screen icon)? (e) at
    UI-scale extremes and in portrait, is the DOM panel over the Phaser canvas
    readable and tappable, with nothing clipped? (f) NOT NOW / GOT IT dismisses
    and it never returns — and the menu keyboard/gamepad nav is live again after
    close? (g) does the >=3-run threshold feel right, or does the hint land
    before the player has decided they like the game?
  - **POLISH-VITALITY-HEAL** — confirm the heal now lands (BUG-VITALITY-HEAL-DEAD,
    `9b520d0`). Agents have no browser. Reach it: BootScene → PRACTICE → START,
    then the dock's BUILD row (or any real run). Check: (a) **the point of the
    fix** — take chip damage to a visible chunk below max, then take **Vitality**:
    the HP bar must jump **+20** at the same instant the max widens, not just
    gain empty headroom. (b) **at full HP** — take Vitality at 100%: the bar
    must stay full and must not overheal past max. (c) **mastery** — the 10th
    Vitality is a bigger jump (`LEVEL_10_BONUSES.vitality`), not +20. (d)
    **relics** — Vitality Core (+15) and Armor Plate (+10) heal on pickup from
    a chest/fortune shrine. (e) **the negative cases must be unchanged** —
    Vampiric Fang (-10% max HP) and the `blood_pact` deal must behave exactly
    as before this fix (see BUG-BLOOD-PACT-HALVE-DEAD: blood_pact's halving is
    *still* dead, on purpose). (f) **no free healing** — play a couple of
    minutes taking damage through a relic drop and a timed buff expiring; HP
    must never silently tick back up on its own. Knobs: `grantBuildHeal` + its
    4 call sites in `src/game/scenes/GameScene.ts`.

---

## Done

(Recent; full per-item write-ups and the complete pre-2026-06-09 changelog live in
**`BACKLOG-archive.md`**.)

- [x] **FEAT-SHIP-PAINT-PICKER — choose or revert your hull paint** (done —
  `ddc54be`). Full write-up in `BACKLOG-archive.md`. Playtest follow-up filed as
  **POLISH-SHIP-PAINT-PICKER** under `## Human gates`.

- [x] **FEAT-ENDLESS-CYCLE-MUTATORS — named per-cycle endless mutators**
  (done — `7fcfd2e`). Was the sole Proposed (auto) item in Next; built to
  completion. **Value:** endless cycles 2+ differed only by stat ramps +
  affix luck; every boss-wave cycle now rolls a named, cycle-wide mutator —
  SWIFT SWARM (trash speed ×1.15), VOLATILE AIR (elite affix chance ×2),
  GOLD RUSH (gold caches ×1.5), XP SURGE (trash XP ×1.25), IRON HORDE
  (trash +2 armor) — uniform roll excluding the previous cycle's pick
  (`rollEndlessMutator` in new pure `src/data/EndlessMutators.ts`),
  announced on the cycle banner ("CYCLE N · GOLD RUSH / +50% GOLD DROPS")
  and pinned in the HUD top-center slot via a lazy sync mirroring
  `syncGauntletHudLabel`. Effects are spawn/roll-time only (trash gate
  xpValue < 30; bosses/minibosses untouched — affix system owns their
  feel); GOLD RUSH hooks the single `spawnRandomConsumable` payload calc.
  Serialized as optional `endlessState.mutator` (no save-version bump,
  `sanitizeEndlessMutator` tamper guard; legacy saves restore mutator-free).
  4 tests pin roll exclusion + sanitize; endless save round-trip extended.
  Files: `EndlessMutators.ts`, `EndlessMutators.test.ts`, `GameScene.ts`,
  `GameStateManager.ts`, `GameStateManager.endless.test.ts`. Feel/balance →
  playtest queue (POLISH-ENDLESS-MUTATORS). Follow-up proposed:
  FEAT-ENDLESS-BEST-CYCLE.
- [x] **FEAT-AFFIX-PARAGON — double-affix Paragon elites for deep endless/gauntlet**
  (done — `b2b30ae`). Was the sole Proposed (auto) item in Next; built to
  completion. **Value:** once cycle-2+ makes single affixes the norm, deep
  runs flatten again; eligible bosses/minibosses (endless cycle 4+, gauntlet
  wave 10+) that rolled an affix now roll a SECOND distinct one 50% of the
  time (`rollParagonAffix` — duplicate + degenerate TITAN↔VAMPIRIC pairing
  excluded from the weight pool), both stat sets damped via the existing
  `softenBossAffixScale`, gold "PARAGON <A1> <A2> <name>" bar/banner via pure
  `affixDisplayName`, gold ring/label marker. New `EnemyAffix.affixType2` ECS
  slot (all addComponent paths write both slots — bitECS recycled-id
  hygiene), serialized as optional `affixType2` (no save-version bump, same
  pattern as `affixType`); restore re-applies both armor bonuses + rebuilds
  the prefixed bar name. VOLATILE death + VAMPIRIC contact checks read both
  slots. Twins share the rolled pair (one setpiece). 8 tests pin the pool
  exclusions + name format. Files: `Affixes.ts`, `Affixes.test.ts`,
  `components/index.ts`, `GameStateManager.ts`, `GameScene.ts`,
  `EliteAffixVisualManager.ts`. Feel/balance → playtest queue
  (POLISH-AFFIX-PARAGON). Follow-up proposed: FEAT-ENDLESS-CYCLE-MUTATORS.

- [x] **FEAT-MINIBOSS-AFFIXES — affixed miniboss variants for endless/gauntlet**
  (done — `8be807f`). Was the sole Proposed (auto) item in Next; built to
  completion. **Value:** endless re-spawns the same 5 minibosses every
  ~20–45s forever and gauntlet from wave 1 with zero variation; eligible
  minibosses (endless cycle 2+, gauntlet wave 4+) now roll the same dampened
  affix as bosses — SWIFT / VOLATILE / VAMPIRIC / TITAN via `rollBossAffix()`
  (35%, BLESSED excluded) with `softenBossAffixScale` damping, prefixed
  health bar + warning banner ("TITAN Glutton"), ring/label via the
  query-driven EliteAffixVisualManager for free. Twins spawn as one setpiece
  and share a single roll (both prefixed, both damped). The shared stat
  application was extracted from spawnBoss into
  `GameScene.applyDampedAffixStats` (boss path now calls the same helper).
  New middle VAMPIRIC tier: contact heal is now boss 5% / miniboss 10% /
  trash 20% via pure `vampiricHealFraction()` in `Affixes.ts` (3 tests pin
  the boundaries) — previously an affixed miniboss would have healed 20% of
  its pool per contact hit. Restore path keeps prefixed bar names for any
  affixed bar-holder (xpValue ≥ 30), not just bosses. Files: `Affixes.ts`,
  `Affixes.test.ts`, `GameScene.ts`. tsc + vite build clean, 1175 tests
  green (1172 + 3). Feel/balance → playtest queue
  (POLISH-MINIBOSS-AFFIXES). Follow-up proposed: FEAT-AFFIX-PARAGON.

- [x] **FEAT-BOSS-AFFIXES — affixed boss variants for endless/gauntlet replay**
  (done — `bbad876`). Was the sole Proposed (auto) item in Next; built to
  completion. **Value:** the 5-boss pool repeats every endless cycle (and
  gauntlet wave 3+) with only stat ramps; eligible bosses (endless cycle 2+,
  gauntlet wave 6+) now spawn with ONE elite affix — SWIFT / VOLATILE /
  VAMPIRIC / TITAN, weighted per AFFIX_META — plus a title-prefixed health
  bar + entrance banner ("VOLATILE Horde King"), multiplying setpiece variety
  for near-zero new content. Mechanics: `rollBossAffix()` in `Affixes.ts`
  (35% gate, BLESSED excluded — bosses already guarantee a consumable +
  data-cache roll); stat multipliers applied at half strength via
  `softenBossAffixScale` (boss HP is pre-doubled; full TITAN 2.4× would drag,
  full SWIFT 1.6× breaks chase feel) with xpScale + flat armor at full;
  VAMPIRIC contact heal is tier-aware (5% max HP for bosses vs 20% trash).
  The Legion excluded (split children wouldn't inherit; shared-pool math
  must not absorb a root-only multiplier). Query-driven
  EliteAffixVisualManager draws the ring/label on the boss for free;
  save/restore already serializes `affixType` generically — restore
  re-applies bonus armor (existing path) and now rebuilds the prefixed bar
  name. Minimap tier still wins (boss blip stays boss); affixed boss kills
  tick the elite-kill bounty (accepted bonus). 5 new tests in
  `Affixes.test.ts` pin the boss pool (no BLESSED), the 35% gate, the band
  walk, and the damping math. Files: `Affixes.ts`, `Affixes.test.ts`,
  `GameScene.ts` (bossAffixEligible + spawnBoss roll + restore bar name +
  vampiric tier), `minimapProjection.ts` (comment). tsc + vite build clean,
  1172 tests green (1167 + 5). Feel/balance → playtest queue
  (POLISH-BOSS-AFFIXES). Follow-up proposed: FEAT-MINIBOSS-AFFIXES.

- [x] **FEAT-BOSS-MITOSIS — 5th boss "The Legion", splitting swarm-lord**
  (done — `d8151ec`). Was the sole Proposed (auto) item in Next; built to
  completion. **Value:** the boss pool is 4 vs 19 weapons — setpiece content
  is the scarce resource, and every existing boss is a single persistent
  entity; The Legion introduces a genuinely new fight grammar: it splits on
  death — root boss → 2 half-scale fragments → 4 quarter-scale motes (7
  entities, one shared HP pool, stats partitioned). Rewards (XP payout,
  guaranteed consumable, data-cache roll, victory) fire only when the last
  living member dies; mid-tree deaths are splits, not kills. The player must
  manage target priority + an encircling crowd instead of dodge-and-focus.
  **Novel mechanic:** split-on-death tree with promoted last-member payout +
  summed group bar + restore rebuild. Pure split-tree/pool accounting lives
  in `legion-split.ts` (11 tests, no Phaser): generation table, pool math
  (any member reconstructs the full 3×rootMax pool), death routing that
  spawns children mid-tree or flags the last death for promotion. AI handlers
  in `enemy-ai/legion.ts`: root lumbering advance + periodic surge lunge;
  fragments/motes encircle the player on a drifting orbit slot with staggered
  lunges. `GameScene.resolveLegionDeath` intercepts legion deaths before the
  normal kill path — mid-tree deaths spawn children and tick combo/kill
  bookkeeping with no rewards; the last death promotes `EnemyType.xpValue` to
  1000 and the enemyTypeMap entry to `'the_legion'`, then falls through to
  the unmodified boss-death path (full XP, drops, cache roll, codex credit,
  victory/gauntlet wave-clear). One shared health bar stays anchored to the
  root's entity id even after the root dies — each frame overwrites that
  payload entry with the summed living+potential pool via
  `forEachLegionGroup`. Save/restore safe: three distinct `EnemyAIType`
  values (104/105/106) serialize the split tier through `typeId`; the
  split-tree group map is rebuilt after `restoreEntities` from restored
  typeIds, with per-member bars suppressed in favor of one rebuilt group bar.
  Files: `EnemyTypes.ts` (3 types + armor), `GameTuning.ts` (boss order),
  `BossArenaSystem.ts` (arena theme), `EnemyVisuals.ts` (`drawLegion` +
  `drawLegionFragment`), `enemy-ai/index.ts` + `EnemyAISystem.ts` (dispatch +
  re-exports), `GameScene.ts` (death branch, entity-removal helper
  extraction, HUD payload override, spawnBoss hook, restore hooks, reset
  call). tsc + vite build clean, 1167 tests green (1156 + 11). Feel/balance →
  playtest queue (POLISH-BOSS-LEGION). Follow-up proposed: FEAT-BOSS-AFFIXES.

- [x] **FEAT-WEAPON-WAKE — 19th weapon "Caustic Wake", movement-driven trail**
  (done — `7e90628`). Was the sole Proposed (auto) item in Next; built to
  completion. **Value:** all 18 prior weapons fire on a clock (or, Guardian, on
  damage taken); none key off the player's *movement*. The Wake is the
  arsenal's first movement-driven archetype: it lays a lingering caustic ribbon
  along the ship's path as it moves, and enemies standing in a live segment
  take ticking damage — output scales with distance travelled, rewarding
  mobility/kiting builds, the inverse of Guardian's face-tank identity.
  **Novel mechanic:** every other weapon is driven by BaseWeapon's
  cooldown→attack loop; the Wake overrides `update()` to skip that loop
  entirely. Distance-gated arc-length emission (drop a segment every 26px
  travelled, not every N seconds) lives in the pure, unit-tested
  `wakeLogic.ts` (8 tests). The class (`WakeWeapon.ts`) owns a 128-segment
  pool, a 4 Hz collision sweep (not per-frame — the per-enemy re-hit gate makes
  finer sampling pointless) gated by `cooldown` repurposed as the re-hit
  interval, and the acid-green trail visual (fading with segment age). Mastery
  **"Undertow"**: enemies caught in the wake are slowed 25% for 0.6s, refreshed
  each pass (FrostNova's `Velocity.speed` set/restore idiom). Evolution
  **"Slipstream"** (via `swiftness` L5): wider (×1.3 range, ×1.2 size), harder
  (×1.45 dmg), faster re-hit (×0.85 cd), and — since duration isn't an
  evolution stat — a dedicated `EVOLVED_LIFETIME_MULT` (×1.35) lets it linger
  longer too. Synergy **"Hit and Run"** (wake+homing_missile kiting build,
  +20% dmg / 10% faster both — Homing Missiles had no synergy yet and was
  flagged cold in BALANCE-2, so this buffs the weakest weapon at the same
  time). Full mirror-list sync: registry (`index.ts`), `UNLOCKABLE_WEAPONS`
  (`Upgrades.ts`), evolution recipe, synergy, `aura` mastery category
  (`WeaponManager.ts` — persistent area damage-over-time, not explosive),
  IconMap (`wind-slap`, reused motion-trail frame). All three locked
  content-integrity test arrays updated (WeaponEvolutions / ShipCharacters
  registry rosters + Upgrades.selection unlockable list). tsc + vite build
  clean, 1156 tests green (1148 + 8). Feel/balance → playtest queue
  (POLISH-WEAPON-WAKE). Follow-up proposed: FEAT-BOSS-MITOSIS (splitting
  swarm-lord boss — the boss pool is 4 vs 19 weapons, the scarcer resource).

- [x] **FEAT-WEAPON-GUARDIAN — 18th weapon "Guardian", reactive retaliation
  nova** (done — `e4fcb27`). Was the sole Proposed (auto) item in Next; built
  to completion. **Value:** all 17 prior weapons fire on a fixed cooldown timer
  that ticks regardless of the game state — none *react* to it. The Guardian is
  the arsenal's first **reactive** weapon: it fires ONLY when the player takes
  real damage, retaliating with a radial nova of shards that erupts from the
  player and knocks the swarm back. It's a genuinely new archetype — it rewards
  aggressive, face-tank play (armor/thorns/HP builds) instead of pure kiting,
  and the nova scales with the hit that provoked it, so tanking a big blow fires
  back harder. **Novel mechanic (vs all 17):** every other weapon is driven by
  BaseWeapon's cooldown→attack loop; the Guardian overrides `update()` to skip
  that loop entirely and is instead driven by a new player-damage event.
  GameScene's single `takeDamage` chokepoint (after all mitigation, right beside
  the existing thorns retaliation) calls the new
  `WeaponManager.notifyPlayerDamaged(realDamage)`, which routes to the equipped
  Guardian; an internal per-hit cooldown gates it so a multi-hit swarm can't
  chain-detonate the orb. Pure lifecycle (arm → tick → re-arm) + the hit-scaled,
  capped damage formula live in the unit-tested `guardianLogic.ts` (10 tests:
  ready→fire→re-arm, swarm chain-detonation guard, tick-to-ready edge, damage
  scaling + bonus cap + zero/negative-hit floor). The class
  (`GuardianWeapon.ts`) owns the pooled radial shards (SpatialHash collision,
  piercing, knockback, rim fade), the amber orb + shockwave-ring burst visual,
  and the level-ramped internal cooldown (1.5→0.9s). Mastery **"Bulwark"**: each
  retaliation grants 0.5s of i-frames (notifyPlayerDamaged returns the bonus;
  `takeDamage` extends `damageCooldown`, never shortens it). Evolution **"Aegis"**
  (via `vitality` L5): a wider (×1.4 size), harder (×1.5 dmg, +2 count) nova whose
  shards knock back far harder (200) and briefly freeze (250ms) what they strike.
  Full mirror-list sync: registry (`index.ts`), `UNLOCKABLE_WEAPONS`
  (`Upgrades.ts`), evolution recipe, **"Riposte"** synergy (guardian+katana
  brawler build, +20% dmg / 10% faster both), `explosive` mastery category
  (`WeaponManager.ts` — the nova is a detonation, so it also scales with
  explosion-damage), IconMap (`sunbeams`). All three locked content-integrity
  test arrays updated (WeaponEvolutions / ShipCharacters registry rosters +
  Upgrades.selection unlockable list). tsc + vite build clean, 1148 tests green
  (1138 + 10). Feel/balance → playtest queue (POLISH-WEAPON-GUARDIAN). Follow-up
  proposed: FEAT-WEAPON-WAKE (movement-driven trail archetype — first weapon
  whose output keys off the player's path).

- [x] **FEAT-WEAPON-SINGULARITY — 17th weapon "Singularity", gravity-well
  crowd control** (done — `440f1cc`). Was the sole Proposed (auto) item in Next;
  built to completion. **Value:** all 16 prior weapons damage or kill enemies
  where they stand — none *reposition* the horde; the only crowd-control lever
  was the `void` hazard zone, never a player weapon. The Singularity is the
  arsenal's first **CC-by-displacement** weapon: a cast lobs a gravity well onto
  the nearest enemy cluster, it yanks nearby enemies toward its core for a short
  window (clumping them), then collapses in an area burst. The clump is the
  point — it makes every other AOE weapon (meteor/aura/spikes) land harder,
  rewarding combo builds, so it raises the whole arsenal's value rather than
  just adding DPS. **Novel mechanic (vs all 16):** it mutates enemy `Transform`
  directly (a capped, gravity-shaped inward tug — stronger toward the core,
  clamped so it never teleports or overshoots), applied in `updateEffects` which
  runs *after* `movementSystem` each frame so the pull isn't fought by enemy AI.
  Bosses are pull-immune and minibosses only 30%-displaced (an anti-swarm weapon
  must not fling a boss across the arena; collapse damage still hits everyone).
  Pure lifecycle (travel → pull → collapse) + the pull-displacement math live in
  the unit-tested `singularityLogic.ts` (12 tests: phase transitions, one-shot
  collapse edge, cap, no-overshoot clamp, gravity falloff). The class
  (`SingularityWeapon.ts`) owns lob targeting (SpatialHash cluster query, wells
  spread across targets), the Transform writes, the falloff+knockback collapse
  burst, and the violet accretion-spiral visual (void palette). Mastery
  **"Event Horizon"** drops a lingering `void` hazard field on collapse (reuses
  the hazard system — sustained clumping); evolution **"Black Hole"** (via
  `reach` L5) widens the well and burns the trapped horde with DOT for the whole
  pull (dmg ×1.4 / range ×1.5 / size ×1.35). Full mirror-list sync: registry
  (`index.ts`), `UNLOCKABLE_WEAPONS` (`Upgrades.ts`), evolution recipe,
  **Gravity Collapse** synergy (singularity+meteor, +25% dmg — clumped enemies
  amplify area blasts), `explosive` mastery category (`WeaponManager.ts` — the
  collapse IS an explosion, so it also scales with explosion-damage), IconMap
  (`spiral-shell`). All three locked content-integrity test arrays updated
  (WeaponEvolutions / ShipCharacters / Upgrades.selection). tsc + vite build
  clean, 1138 tests green (1126 + 12). Feel/balance → playtest queue
  (POLISH-WEAPON-SINGULARITY). Follow-up proposed: FEAT-WEAPON-GUARDIAN
  (reactive/retaliation archetype — first weapon triggered by player damage).

- [x] **FEAT-WEAPON-SENTRY — 16th weapon "Sentry Turret", deployable
  auto-turret** (done — `58901ef`). Was the sole Proposed (auto) item in Next;
  built to completion. **Value:** all 15 prior weapons are player-attached
  (projectile / orbit / beam / return / drone-orbit); the Sentry is the
  arsenal's first *deployed* weapon — a placement drops a stationary auto-firing
  turret at the player's position and leaves it there. That adds a genuinely new
  archetype the arsenal lacked: **positional play** — anchor a chokepoint, build
  a gun line as you level, then kite the horde back through your own fire.
  **Novel mechanic (vs all 15):** every other weapon fires from / follows /
  returns to the player; a sentry lives on its own where you dropped it, with an
  independent lifetime + fire cadence. That lifecycle is the pure, unit-tested
  core (`src/weapons/sentryLogic.ts`, 7 tests): deploy → age → target-gated fire
  → expire, with idle turrets holding their shot at ready (no banked burst) so a
  gun line's uptime stays honest. The class (`SentryWeapon.ts`) owns placement
  (rolling max-count = `count`, retire-oldest), SpatialHash targeting (nearest in
  range 240), pooled piercing bolts (`piercing N = hits N+1`, matching
  ProjectileWeapon), and the turret visual (hex mount + aimed/idle-sweeping
  barrel + deploy ping + fade-near-expiry, drawn into shared Graphics — the
  `turret` enemy's language inverted to friendly cyan; no atlas frame). First
  turret drops ~0.5s in via a `lastFired` offset so a Sentry starting weapon
  isn't idle for a full deploy cooldown. Mastery **"Overclock Array"** deploys
  two flanking turrets per placement (count is 5 at L10, so both survive);
  evolution **"Rail Sentry"** (via `piercing` L5) fires heavy piercing rail
  lances (dmg ×1.6 / range ×1.3 / piercing +3), rendered as a bright lance.
  Full mirror-list sync: registry (`index.ts`), `UNLOCKABLE_WEAPONS`
  (`Upgrades.ts`), evolution recipe, **Automated Arsenal** synergy (sentry+drone,
  +20% dmg / 10% faster to both — reinforces the autonomous-summon build),
  `summon` mastery category (`WeaponManager.ts`), IconMap (`on-target`). All
  three locked content-integrity test arrays updated (ShipCharacters /
  WeaponEvolutions / Upgrades.selection). tsc + vite build clean, 1126 tests
  green (1119 + 7). Feel/balance → playtest queue (POLISH-WEAPON-SENTRY).
  Follow-up proposed: FEAT-WEAPON-SINGULARITY (enemy-repositioning CC archetype).

- [x] **FEAT-BOSS-BASTION — 4th boss "The Bastion", siege artillery**
  (done — `37297d1`). Proposed (auto) + built this session: Now/Next were
  empty and Later held only the glyph sweep (busy-work per the value gate)
  + the human playtest queue. **Value:** the boss pool was 3 — every mode
  that cycles bosses (standard 10-min spawn, endless `spawnNextBoss`,
  GAUNTLET multi-boss waves capped at 3 bosses) repeated the same three
  fights fast; a 4th boss is new setpiece content in every mode at once.
  **Novel mechanics (vs all 3 existing):** (1) zone-denial at the PLAYER's
  position — telegraphed mortar strikes land where you stand
  (`groundSlamCallback` at planned points; existing bosses only damage at
  their own position or via projectiles); (2) inverted chase — it RETREATS
  to hold mortar range (380±60), the one boss you must corner (screen-bounds
  clamp pins it at walls — cornering is the counterplay, reviewer-verified);
  (3) phase 2+ rolling barrage marching a strike line through you (forces
  lateral dodge). Pure planning module `enemy-ai/bastion-barrage.ts`
  (scatter ring band 70–170, drumroll staggers, march geometry with bounded
  perpendicular jitter, phase scaling 3/4/5 shells + fuses 1.2/1.05/0.9s
  with a test-locked 0.9s dodge floor — review fix bumped the rolling base
  fuse 0.85→0.9 and added the near-player warning lock), 13 tests, seeded
  RNG. Handler keeps strike plans in a module map — `resetBastionStrikes()`
  wired beside `resetBossPhaseTracking()`; restore into the firing state
  finds no plan and safely reloads (plans deliberately not persisted).
  Telegraph spec follows the contract idiom (78 ≥ blast 70, duration ==
  flight time; 2 contract tests added). Integration = the six per-boss
  tables (TUNING.bosses.order, ENEMY_TYPES + ENEMY_ARMOR 14, drawer
  registry — bastioned-fortress silhouette with forward mortar tube,
  boss-arena burnt-bronze theme, spawnBossHazard burn craters, AI dispatch
  + barrel exports); codex/health-bar/death-cinematics/drops/gauntlet scans
  key off `xpValue >= 1000` automatically. tsc + vite build clean, 1119
  tests green (1104 + 15). Feel/balance → playtest queue
  (POLISH-BOSS-BASTION). Reviewer also noted a pre-existing oddity (not
  this diff): horde-king `phaseSpeedMult = 1 + (3 - phase) * 0.2` is slower
  in later phases despite its "faster" comment — left untouched (behavior
  change = balance call).

- [x] **BUG-SHIP-ID-NOT-SAVED — run launch identity (ship/weapon/pacts)
  survives a refresh** (done — `cf38937`). `shipId`, `startingWeapon`, and
  `pactIds` were accepted by `GameScene.init` but never written into
  `GameSaveState`, so a mid-run refresh restored the run with the default
  hull family + neon palette (stat bonuses survived — baked into saved
  playerStats) and PLAY AGAIN after a restored death rebuilt a default-ship,
  no-pact run with re-rolled modifiers. Save now carries
  `shipId`/`startingWeaponId`/`pactIds` (optional → legacy saves keep the
  pre-fix defaults); restore assigns them sanitized (length-capped strings,
  pacts revalidated via `getPactById`) BEFORE `restoreEntities` builds the
  player visual, so the right hull renders; nothing is re-applied stat-wise.
  The PLAY AGAIN `settings.data` rewrite (non-daily branch) now passes the
  full original launch payload — stage + mode + ship/weapon/modifiers/pacts —
  matching what a non-restored PLAY AGAIN reuses via Phaser's settings.data
  (the daily branch still regenerates from the date, which stays
  authoritative). Unknown ids are harmless by construction: every ship
  consumer falls back `getShipById(...) ?? getDefaultShip()`, and the weapon
  id only reaches the fresh path's `createWeapon(...) || new
  ProjectileWeapon()` guard. 2 round-trip tests
  (`GameStateManager.runIdentity.test.ts`, daily-test idiom) pin the
  accepted-but-never-written save-field class (previously hit
  `ultimateCharge`, then `dailyState`). tsc + vite build clean, 1104 tests
  green (1102 + 2). Human browser check → POLISH-RUN-IDENTITY-RESTORE
  (playtest queue).

- [x] **BUG-DAILY-MODE-RESTORE — daily/weekly identity survives a refresh**
  (done — `5d50c79`). A refresh mid-daily-run silently demoted it to a
  standard run: the mode flags lived only in scene init data, so CONTINUE
  restored with `dailyModeActive=false` and death/victory never called
  `recordDailyRun` — the day's leaderboard entry was lost to an accidental
  reload. Save now carries `dailyState {active, date, challengeType}`
  (new `SerializedDailyState`, mirrors the gauntletState shape; restore
  assigns unconditionally so a prior daily's fields can't leak into a
  restored standard run, and sanitizes — bad/oversized date or unknown
  type falls back to standard/daily). The PLAY AGAIN `settings.data`
  rewrite now regenerates the FULL challenge config when the saved date is
  still current (daily/weekly configs are deterministic from the date via
  `generateDailyChallenge`/`generateWeeklyChallenge`), so a replay gets the
  real modifiers/ship/weapon — sidestepping BUG-SHIP-ID-NOT-SAVED for this
  mode only; a rolled-over date drops to a standard run, same as the menu
  would offer. 3 round-trip tests (`GameStateManager.daily.test.ts`,
  endless-test idiom) lock the save()→load() pass-through — the
  accepted-but-never-written field bug class that previously hit
  `ultimateCharge`. tsc + vite build clean, 1102 tests green (1099 + 3).
  Human browser check → POLISH-DAILY-RESTORE (playtest queue).

- [x] **FEAT-GAUNTLET — boss-rush game mode** (done — `ed2dbb3`).
  Proposed (auto) + built this session: Now/Next were empty and Later
  held only a cosmetic glyph sweep (busy-work per the value gate) + the
  human playtest queue. **Value:** a new instant-action way to play — the
  game's setpiece fights (5 minibosses + 3 bosses, phases, telegraphs,
  arenas) existed only as scheduled beats inside a 10-minute run or deep in
  post-victory endless; GAUNTLET makes them the whole game from minute 0.
  Waves of minibosses/bosses (pure escalation table
  `src/game/gauntlet/gauntletWaves.ts`: 1mb → 2mb → boss → boss+1mb → …,
  caps 3 bosses + 6 minibosses, boss overflow converts to minibosses;
  ×1.12 HP / ×1.08 dmg / ×1.06 XP per wave) over the normal trash stream
  (XP economy intact), kill-driven wave clears (throttled frame-cache scan
  for alive `xpValue >= 30`, never on a spawn-release frame), wave-clear gold
  (25+15·wave) + 2 health pickups + banner, 5s breather, best wave persisted
  (`survivor-gauntlet-best`, registered + locked by the StorageBootstrap
  scan). Full build selection (GAUNTLET deck card → stage/ship/weapon/pact
  flow with a mode-tagged subtitle; 7-card deck row shrink-to-fit in
  portrait). Wave loop runs from the gated update tick (freezes with
  pause/modals/death — exploder-fuse lesson), spawns reuse
  spawnMiniboss/spawnNextBoss. Save/restore: `gauntletState`
  {active, wave, phase, phaseTimer, newBestThisRun}, sanitized restore;
  restore-into-combat with nothing alive re-queues the wave (no
  save-scum free clear). Death screen swaps the score line for
  "GAUNTLET · WAVE N (Best M)"; gauntlet deaths don't break the win streak
  and skip the per-world score table / recent-runs strip / daily leaderboard
  (no standard-record pollution); boss kills don't trigger
  victory/advanceWorldLevel. HUD "WORLD N" slot shows "GAUNTLET · WAVE N"
  (new `HUDManager.setTopCenterLabel`). Boss atmosphere/lighting now
  tracks `activeBossType` and survives until the LAST boss in a multi-boss
  wave dies (also fixes endless cycle-3+). Review agent found + fixed a
  critical Phaser scene-data leak (stale `gauntletMode` would have infected
  every later standard PLAY — both `startNewGame` sites now pass explicit
  data) and `restoreGameState` now rewrites `scene.settings.data` so PLAY
  AGAIN after a restored death keeps mode + stage. 9 unit tests
  (escalation table, caps, spawn plan, gold curve, best-wave parse
  corruption). tsc + vite build clean, 1099 tests green. Feel/balance →
  playtest queue (POLISH-GAUNTLET); discovered pre-existing gaps filed
  (BUG-DAILY-MODE-RESTORE, BUG-SHIP-ID-NOT-SAVED).

- [x] **POLISH-TOUCH-PRESS-RELEASE — press/release selection for stage + weapon
  cards** (done — `abb7e3e`). Stage and weapon cards committed on pointerdown, so
  a stray touch instantly locked in a choice; ship cards already used
  press/release (#41). Mirrored the ship-card trio on both steps: pointerdown
  records `pressedCardId` (renamed from `pressedShipCardId`, now shared — steps
  are exclusive and `clearStepUI` resets it) + sets hover/focus, pointerup over
  the same card commits, scene-level pointerup/pointerupoutside (shared
  `registerPressedCardClearing()`) cancels on drag-off. Weapon-card pointerdown
  also syncs MenuNavigator focus (mirrors ship). RANDOM button moved from a
  manual pointerdown to MenuButton `onActivate` (pointerup) — it was the only
  button in the codebase committing on press. Verified in Phaser source that
  GameObject pointerup fires before plugin-level POINTER_UP, so a commit always
  beats the scene-level clear. No pure logic worth a unit test (Phaser-coupled
  handler wiring, same shipped pattern). tsc + vite build clean, 1090 tests
  green. On-device feel → playtest queue (POLISH-SHIP-TOUCH-SELECT, extended).

- [x] **FLEET SWEEP 2026-07-04 — the implementable backlog cleared in one
  batch** (operator directive: "implement everything"). Hash in the commit
  archiving this entry; detail per item:
  - **REFACTOR-2 phases 2+3**: miniboss (glutton/swarm-mother/charger/
    necromancer/twin) AND boss (horde-king/void-wyrm/the-machine) handlers +
    boss-phase tracking + elite auras extracted to `enemy-ai/` modules;
    EnemyAISystem.ts is dispatcher+LOD only, 213 lines (was 1,038; originally
    2,098). All 14 moved blocks verified byte-identical vs the pre-move blob;
    external imports preserved via re-exports.
  - **BALANCE-EXPLODER-FUSE** (operator-approved): Exploder death explosion
    now arms a 0.4s fuse with a danger ring (radius 66 >= blast 60), detonated
    from the gated update() tick (freezes with pause/game-over — a
    delayedCall would have exploded into menus). Pure fuse module + 11 tests
    (incl. a float-epsilon detonation bug caught during dev). VOLATILE affix
    stays instant (still parked). Feel → playtest queue.
  - **FEAT-CARDS-3 — boost cards**: 8 one-run boosts (spec section in the
    card design doc), miniboss flux caches (10%, exclusive with data caches,
    one held max), `survivor-meta-boosts` persistence, consumed on fresh run
    start only (survives save-restore), armed-boost line on the BootScene
    hero card + pickup/run-start toasts. Manager corruption-suite mirrors
    the card manager's.
  - **FEAT-RUNNER-MODE v1**: new RunnerScene (auto-scroll dodge-and-survive,
    orientation-aware axis, pooled runner-local combat structs — shared ECS
    deliberately NOT driven from a second scene for containment);
    PlayerSpaceship/Parallax/Joystick/SecureStorage reused; best score
    persisted ('survivor-runner-best'); RUNNER entry (6th deck card) on the
    main menu. Cut list filed as FEAT-RUNNER-MODE-V2. ENTIRELY additive —
    failure modes contained to the mode itself. Feel → playtest.
  - **HANGAR ship preview**: the evolution-cycling ShipPreview now also sits
    in the shop's HANGAR header (landscape only; portrait header is full),
    tracking the focused mod card.
  - **MODS readout** on ship-select cards: muted instead of dim at 0 mods
    (was invisible on phones).
  - **NOT done, with reasons**: POLISH-UI-CAMERA + POLISH-CANVAS-DPR (both
    marked do-not-land-blind — need real-device runtime verification);
    BUG-FREEZE-VERIFY + the whole playtest queue (need a human in a
    browser); POLISH-ACCOUNT-GATE-TOAST (its own precondition — no ship
    uses `account:` — still unmet); REFACTOR-1 (multi-session god-object
    split of the live core loop; not containable, needs its own plan
    cycle); BALANCE-EXPLODER-FUSE's VOLATILE-affix half (explicitly parked).

- [x] **FEAT-SHIP-MODS-2 — ship mod follow-ups** (done — `ec6c47a`).
  Archetype icons on HANGAR cards (test-locked to ICON_MAP), "MODS n/9"
  readout on ship-select cards (gold MODS MAXED at cap), hangar-mastery
  achievements (Ace Mechanic → Fleet Admiral, fed by
  `getFullyModdedShipCount()`, ShopScene wires unlock delivery + detaches
  on shutdown; Fleet Admiral's target test-locked to the roster size).
  Built on direct operator request ahead of the BALANCE-SHIP-MODS playtest.

- [x] **FEAT-SHIP-MODS-1 — per-ship mod tracks + HANGAR shop tab**
  (done — `261d9dc`). 3 identity tracks per ship (12 shared archetypes),
  3 levels each at 400/700/1200 gold, HANGAR tab in the shop (compact tab
  labels below 85px/tab so 8 tabs fit portrait), run-start application after
  ship bonuses, SecureStorage persistence + corruption-hardened loader,
  ~40 unit tests. Spec (frozen API contract + economy):
  `docs/superpowers/specs/2026-07-03-ship-mod-tracks-design.md`. Economy is a
  first pass shipped on direct operator request (the old human-gate) —
  tuning owned by BALANCE-SHIP-MODS (playtest queue); follow-ups in
  FEAT-SHIP-MODS-2. Full write-up in `BACKLOG-archive.md`.

- [x] **FEAT-PORTRAIT — portrait mode support** (done — `c433efc`).
  Orientation-aware base game size (1280×720 ↔ 720×1280 under EXPAND, so the
  shorter side is always 720 game units), debounced flip watcher in main.ts
  (menus restart with original payload; GameScene save-restore round trip;
  level-up modal defers), HTML rotate-blocker removed, and portrait reflows
  for Shop/Credits/Achievements/WeaponSelect/PactSelect/Leaderboard/Music/
  Cards/Upgrade plus pause + game-over panel stacking. Landscape math
  verified unchanged everywhere (grep-level + arithmetic). Full write-up in
  `BACKLOG-archive.md`. On-device verification → POLISH-PORTRAIT (playtest
  queue); known cuts listed there.

- [x] **FEAT-CARDS-2 — card collection follow-ups** (done — `08a196c`).
  Deferred discovery (cache cards stay hidden until the end-screen reveal —
  `peekPendingReveal` added, consumption is now the discovery moment),
  ARCHIVE BONUS aggregate summary on the CardsScene idle detail line
  (`formatCardBonusSummary`, pure + tested), four `cards_discovered`
  milestone achievements (1/6/12/24 → gold; entry sync retro-credits
  pre-milestone collections), menu-context reward banking fix in
  AchievementManager (no-callback unlocks stay unclaimed for the
  AchievementScene retro-claim instead of silently eating gold), reveal
  sfx on scanner flips and end-screen reveals, icon pass verified
  (all 24 keys resolve, test-locked). Full write-up in
  `BACKLOG-archive.md`. Drop-rate/cost balance pass stays a human call →
  playtest queue (POLISH-CARDS).

- [x] **FEAT-CARDS-1 — card collection + scanner lottery meta-progression**
  (done — `caaba4e`). Sky Force Reloaded-inspired card loop per the durable
  spec (`docs/superpowers/specs/2026-07-03-card-collection-meta-design.md`):
  24 cards, in-run data-cache drops with end-screen reveal, DECRYPT lottery
  with pity, CARD ARCHIVE scene. Full write-up in `BACKLOG-archive.md`.
  Follow-ups folded into FEAT-CARDS-2; feel/balance → playtest queue
  (POLISH-CARDS).

- [x] **BUG-STORAGE-PRELOAD-GAPS** — 9 SecureStorage keys silently never
  persisted across a reload (done — `1e8467a`). Found this session while
  scouting for the next item (Now/Next empty, Later all busy-work/blocked —
  see FEAT-UPGRADE-LOCK etc. below for that same pattern). **Root cause:**
  `SecureStorage.getItem` answers only from `StorageEncryption`'s in-memory
  cache; `initializeStorage()` (awaited before the Phaser game is even
  constructed, `main.ts`) populates that cache **only** for keys listed in
  `StorageBootstrap.ALL_STORAGE_KEYS`. A key missing from that list still
  writes fine (`setItem` populates the cache immediately, so same-session
  reads look correct) but reads back as `null` on every fresh page load,
  because the encrypted value sitting in real `localStorage` is never loaded
  into cache. Source-scanned every `STORAGE_KEY*` constant in `src/` against
  the list and found **9 silently orphaned**: `settings-colorblind-mode` /
  `settings-high-contrast` / `settings-reduced-motion` (three shipped
  accessibility settings — FEAT-COLORBLIND-UI — revert to default every
  reload, defeating the point for a player who set them), `settings-tutorial-seen`
  (first-run coach marks replay every session instead of once),
  `settings-screen-shake-intensity` / `settings-minimap-enabled` /
  `settings-director-debug` (drop back to their pre-tune default each reload),
  and — the largest blast radius — `hiddenUnlocksV1` (hidden-gated
  ship/content unlock progress resets) and `dailyLeaderboardV1` (the
  **entire** daily/weekly challenge leaderboard, `LeaderboardScene`'s
  "Balatro-style personal bests + challenge history", reset to empty on
  every reload — it never actually persisted day-to-day in practice).
  **Fix is additive-only:** register all 9 in `ALL_STORAGE_KEYS`; no manager
  read/write logic changed. New `src/storage/StorageBootstrap.test.ts`
  source-scans `src/` (via `import.meta.glob('?raw')`, mirroring the
  `?raw`-source-scan idiom in `PermanentUpgrades.test.ts`) for the
  `STORAGE_KEY*` naming convention and locks **both** directions (nothing
  declared is unregistered, nothing registered is orphaned) so a future
  manager can't repeat this silently — confirmed `SettingsManager.test.ts`
  structurally could never have caught this (it mocks `SecureStorage` as a
  flat map with no preload gate to violate). Teeth verified by hand: removing
  one key from the list fails the test naming exactly that key; adding a fake
  extra key fails the orphan check naming it. tsc + vite build clean, 868
  tests green (864 + 4).

- [x] **FEAT-UPGRADE-LOCK** — lock a level-up card so reroll keeps it
  (done — `b5ac24e`). Proposed (auto) + built this session: the Now/Next queues were
  empty and every Later item was a refactor (busy-work per the value gate), blocked on
  human sign-off, or a multi-session epic. **Value:** the level-up modal already had
  reroll / skip / banish but **not lock** — the one canonical survivor-like upgrade-modal
  staple it lacked. Locking lets George *pin* the card he wants (a weapon level he needs
  for an evolution, a key passive) and reroll only the **other** slots, so he can commit
  to a build target instead of gambling the whole hand on every reroll — it makes the
  existing reroll economy (permanent-upgrade rerolls + ship `startingRerollBonus` + event
  reroll rewards) *strategic*. **Mechanic = reroll-pinning within one level-up:** locks
  carry across that modal's rerolls/banishes and reset on the next fresh level-up (no save
  field — transient modal state). Pure core `src/data/upgradeLocks.ts`
  (`mergeLockedIntoOffers` pins locked cards to the front + dedups + fills from the fresh
  roll; `lockCapacity` = count−1 so a reroll always changes ≥1 card; `toggleLockedId`
  add/remove with the cap, never mutates input) — **18 unit tests** (TDD: RED→GREEN;
  identity-preservation, dedup vs fresh, in-list dedup, count cap, no-mutation). Input on
  all three surfaces: per-card gold padlock pip (mouse/touch, drawn with Graphics — no new
  atlas), `[L]` on the keyboard-focused card, and gamepad **West/✗** via a new reusable
  `MenuNavigator.onSecondary` (edge-detected X button; 3 tests incl. disabled-no-stale-edge).
  The pip sits above the card hit-zone with `input.setTopOnly(true)` + `stopPropagation`
  so clicking it never also selects. Gated on `rerollsRemaining > 0` (lock is meaningless
  without a reroll to pin against) + a discoverability hint line. GameScene owns the locked
  set: `mergeLockedIntoOffers(this.lockedUpgrades, fresh, totalChoices)` in
  `showUpgradeSelection`, pinned ids passed to/from the scene on reroll/banish, reset in
  `processNextLevelUp`. Banishing a locked card drops only it (others survive). tsc + vite
  build clean, 864 tests green (843 + 18 + 3). Pip placement / hint legibility / front-pin
  reorder feel → playtest queue (POLISH-UPGRADE-LOCK).

- [x] **FEAT-WEAPON-BOOMERANG** — new 15th weapon "Boomerang Glaive"
  (done — `eae930d`). Proposed (auto) + built this session: the Now/Next queues
  were empty and every Later item was a refactor (busy-work per the value gate),
  blocked on human sign-off, or a multi-session epic. **Value:** build variety is the
  core appeal of a survivor-like, and all 14 prior weapons fire-and-forget (straight /
  orbit / spiral / homing / beam / bounce-between-enemies) — **none return.** The
  Boomerang Glaive carves *out* to `range` (decelerating to an apex) then homes *back*
  to the player's CURRENT position (chases a player who has walked away), striking
  enemies on **both** legs (one enemy hittable up to `piercing` times across the
  out + back passes). It rewards positioning — the return path sweeps the lane you
  retreat through — and gives George a new build to chase. **Novel mechanic = the
  trajectory**, extracted to the pure, Phaser-free `src/weapons/boomerangMotion.ts`
  (`createBoomerangState`/`maxOutboundDistance`/`stepBoomerang`: outbound trapezoidal
  decel ramp → apex == `range` → return-homing with no-overshoot clamp + zero-distance
  guard → caught within `catchRadius`), **13 unit tests** (TDD: RED first; the RED run
  drove two real design fixes — angle moved onto per-glaive state since one volley
  shares a stat-derived params object, and catch made same-frame-responsive instead of
  one frame late). `BoomerangWeapon` extends BaseWeapon (32-glaive pool, shared-Graphics
  spinning-glaive visual brightening on the return leg so the carved lane reads — **no
  projectile-atlas change**, quality-aware). Safety lifetime is derived from the actual
  round-trip (`2·range/speed` outbound + return estimate), NOT a flat constant, so a
  long-range/evolved glaive is never culled mid-return (self-review catch). Mastery
  **Twin Glaives**: every throw also fires a mirrored volley behind you. Fully wired into
  the ecosystem: `WeaponRegistry`, `UNLOCKABLE_WEAPONS` (level-up unlock card), evolution
  recipe **Eclipse Glaive** (`reach` L5 → +70% dmg / +40% range / +1 count / +40% size),
  `boomerang`→`star-swirl` icon, `projectile` mastery category, and a new **Rebound
  Theory** synergy with ricochet (+20% dmg / 10% faster — both "comeback" projectiles).
  Codex + weapon-select picker render it automatically (registry-derived metadata). The
  three content-integrity test mirror-lists synced (`WeaponEvolutions.test`,
  `ShipCharacters.test`, `Upgrades.selection.test`) so "one evolution per weapon" etc.
  stay accurate. tsc + vite build clean, 843 tests green (830 + 13). Visual placement/
  feel + balance → playtest queue (POLISH-WEAPON-BOOMERANG below).

- [x] **FEAT-SYNERGY-VISIBILITY** — surface weapon synergies to the player
  (done — `ccc79f8`). Proposed (auto) + built this session: the Now/Next queues
  were empty and the Later items were refactors (busy-work) / blocked / playtest-only.
  **Value:** the weapon-synergy system (`src/data/WeaponSynergies.ts`, 10 named pairs
  like *Thermal Shock* / *Blade Dance* granting real passive damage + cooldown
  bonuses to both weapons) was **completely invisible** — `getActiveSynergies()` had
  **zero consumers** and the only activation feedback was a generic sound (in fact the
  same `playSynergyActivation()` sound is reused for the miniboss/boss-phase banners,
  so even that wasn't synergy-specific). Players could never tell a synergy fired, what
  it did, or which were active, so they couldn't intentionally build around the
  build-crafting layer. Now surfaced in two places: **(1)** an activation toast the
  moment a weapon pickup/level completes a pair (`⚡ <name> — <description>`, cyan,
  3.2s) via a new `WeaponManager.onSynergyActivated` callback; **(2)** an **ACTIVE
  SYNERGIES** section on the pause BUILD STATS dashboard listing each active synergy +
  its `+x% dmg / +y% spd` magnitude. Pure core `diffActivatedSynergies(prev, current)`
  in `WeaponSynergies.ts` reports only newly-completed pairs (keyed by unique name;
  diffs the sets so a same-frame lose-one/gain-one swap still fires — a count check
  would miss it), unit-tested (7 tests: empty, new, unchanged/no-refire, lost-not-gained,
  swap, multiple-at-once, addition-keeps-existing). Wiring: callback added to
  `WeaponManager.setCallbacks` (4th optional arg), wired on **both** fresh + restore
  GameScene paths — restore wires it *after* the weapon re-add loop so re-equipping a
  synergized build on save-restore doesn't spam toasts; fresh path starts with one
  weapon so no pair exists at run start. `activeSynergies` added to the pause payload
  (`PauseGameState`). tsc + vite build clean, 830 tests green (823 + 7). Placement/feel
  on real devices → playtest queue (POLISH-SYNERGY-VISIBILITY).

- [x] **FEAT-MINIMAP-RADAR** — tactical minimap / threat radar
  (done — `7efc392`). The last unbuilt item from the operator's own rated top-10
  (`FEATURE_PLAN.md` #5, "awareness gap"); #1–4,6,7,10 already shipped. A
  player-centered radar disc on the mid-right HUD edge (the only HUD zone free of
  the top-right pause/stats row, the bottom-right touch buttons, and the
  center combo readouts). Blips: bosses/minibosses/elites + the enemy swarm
  (stride-sampled to a 48-blip cap so dense waves stay readable + cheap; high-value
  threats bypass the stride and always show) + pickups (treasure chests + floor
  consumables). Off-radar contacts clamp to the rim with direction preserved —
  strictly more than the edge-arrow `OffScreenIndicatorManager` conveys. Pure
  projection/classification core `src/visual/minimapProjection.ts`
  (`projectToRadar`/`classifyEnemyKind`/`blipStyle`) unit-tested (16 tests:
  linear scale, exact-rim boundary, rim clamp, diagonal-on-rim, negative dirs,
  NaN/Infinity + zero-radius guards, tier-vs-elite classification, style tier
  ordering). `MinimapManager` owns only Phaser drawing: static chrome drawn once,
  blips redrawn into one pooled Graphics (single draw call), reduced-motion-aware
  sweep, HUD-scale aware, depth 1895 (matches the sibling indicator). GameScene
  `updateMinimap()` feeds it from the shared frame cache + a pooled, never-
  reallocated entry buffer; constructed once per run (fresh + restore), torn down
  in shutdown. New persisted `minimapEnabled` setting (default on) + VISUALS-card
  toggle, fully kbd/gamepad-nav wired. tsc + vite build clean, 823 tests green
  (807 + 16). Placement/feel on real devices → playtest queue
  (POLISH-MINIMAP-PLACEMENT).

- [x] **BUG-SAVE-DROPPED-FIELDS** — run save stopped silently dropping fields
  (done — `1f83a3d` ultimate charge + `d58223f` endless/won state). Two real
  refresh-recovery gaps in `GameStateManager.save()`, both "the field is declared
  but the serialized `state` literal never writes it". (1) **Overdrive charge:**
  `ultimateCharge` was an interface field + a `save()` param + read on restore
  (`state.ultimateCharge ?? 0`) but never assigned into `state` → the meter
  silently emptied on every reload despite FEAT-ULTIMATE-OVERDRIVE claiming
  persistence. One-line fix. (2) **Endless mode:** the 6 endless fields
  (active/time/miniboss+boss timers/cycle/ramped interval) + `hasWon` were never
  saved → a refresh deep in post-victory endless reverted to plain director
  spawns (losing wave cadence + cycle escalation; the difficulty ramp survived
  only via the already-persisted `worldLevel*Mult`) AND reset `hasWon=false`, so
  killing the next endless boss re-fired `showVictory()`+`advanceWorldLevel()` —
  a duplicate victory / extra world level / double gold+streak. Grouped
  `endlessState` like bountyState/shrineState; restore sanitizes each value
  (non-finite → fresh default, no NaN timers) and the later "reset other state"
  block no longer clobbers the restored `hasWon`. 10 new round-trip tests
  (`GameStateManager.ultimate.test.ts` ×4, `GameStateManager.endless.test.ts` ×6:
  partial/full/zero/legacy charge; active/inactive/legacy endless+won). tsc +
  vite build clean, 807 tests green. **This is what the "refresh-persistence vein
  closed" claim below actually missed** — the vein is now genuinely closed.

- [x] **FEAT-ULTIMATE-OVERDRIVE** — net-new active player ability "Overdrive"
  (done — `895c4be` pure core + `cd18cd9` wiring). Closed the biggest gameplay gap
  (the old FEATURE_PLAN.md rated player abilities 1/5; only the *passive*
  `ultimateMastery` weapon multiplier existed — no active ability but dash). New
  module-state `src/systems/UltimateSystem.ts` (mirrors ComboSystem): a charge meter
  fills from kills + damage dealt; once full, Q / gamepad Y / a new mobile touch
  button fires a screen-clearing nova (damage scales with `damageMultiplier` + game
  time via pure `computeUltimateNova`) plus gold flash, shake, brief slow-time, and a
  new `SoundManager.playUltimate()`. Charge is **suppressed** around the nova so its
  own `detonateArea` damage can't recharge the meter (locked by test). HUD gold bar
  below the XP bar (whitens/glows/[Q] when ready), mirrored on the mobile button.
  Persistence: `GameSaveState.ultimateCharge?` (corruption-hardened restore; legacy
  saves start empty). **Note:** the save path silently dropped this field at ship
  time — the meter never actually survived a refresh until BUG-SAVE-DROPPED-FIELDS
  (`1f83a3d`) wired the missing `state` assignment. One-time `ultimate-ready` tutorial hint on the rising edge.
  19 pure-core tests + 1 hint test (TDD: RED→GREEN throughout). tsc/build clean, 800
  tests green. Tuning (charge rates `ULTIMATE_CHARGE_PER_KILL`=2.5 /
  `_PER_DAMAGE`=0.012, nova damage/radius, slow-time window) + feel → playtest queue
  (BALANCE-ULTIMATE below).
- [x] **FEAT-PAUSE-RUN-STATS** — live build dashboard on the pause overlay
  (done — `7d153bd`). New pure module `src/game/managers/buildStats.ts`
  (`deriveBuildStats` + primitives `perMinuteRate`/`perSecondRate`/`safeRatio`/
  `orderWeaponsByDamage`) turns the run's per-weapon stats + elapsed time +
  kill count + damage taken into the dashboard numbers — Phaser-free so it's
  unit-testable (28 tests). Every rate guards divide-by-zero: the pause menu can
  open one frame in (time ~ 0, no hits) → must never render NaN/Infinity (locked
  by the "empty run" + "one frame in" tests). `PauseGameState` gained
  `weaponStats` + `totalDamageTaken` (fed from `WeaponManager.getWeaponRunStats()`
  / `this.totalDamageTaken` in GameScene's `getGameState`). New `BUILD STATS`
  panel on the **left** of the pause overlay (run-modifiers stays on the right —
  no collision): headline DPS / crit % / kills-min / dmg taken, then top-5
  weapons by damage with each weapon's share, as a two-column label/value text
  pair (aligns columns without one named object per cell). Mirrors the
  run-modifiers panel lifecycle exactly — stagger-animated in, torn down by
  registered name in `hidePauseMenu` (4 names added). Weapon-attributed kills can
  differ from run kills, so kills/min uses the run `killCount`, not the weapon
  sum. Visual placement/feel → playtest (no balance/timing change).
- [x] **FEAT-SHIP-ACCOUNT-GATE** — documented `account:<level>` ship gate wired
  (done — `a41c64e`). New pure `src/data/UnlockGates.ts`:
  `isUnlockRequirementMet(requirement, {unlockedConditionIds, worldLevel,
  accountLevel})` — single parser for ship + stage gates, exact legacy semantics
  (falsy/unknown-prefix → unlocked, `Number(...) || 0` malformed levels); 17 tests.
  Both `WeaponSelectScene` availability filters delegate to it; ships gain
  `account:<n>` via `getAccountLevel()`. Ship gate lock widened to
  `hidden:|account:\d+`; stage lock deliberately stays `hidden:|worldLevel:` (doc
  promises only those — widen consciously). Roster unchanged: gating an existing
  ship strips live content (human balance call) — adding an account-gated ship is
  now a one-line data edit. Note: account-gated ships re-lock after ascension
  reset (consistent with account-gated shop upgrades). Teeth: 3 mutations/controls
  (`>=`→`>`, junk `account:abc` gate, valid `account:5` positive control) — all
  behaved. Follow-up filed: account-gate unlocks are silent (no toast — hidden
  unlocks toast via HiddenUnlockManager; account thresholds cross silently in the
  shop). Only matters once a ship actually uses `account:`.
- [x] **TEST-CONTENT-DATA-INTEGRITY** — Affixes/Stages/Ships table locks (done — `f93e1d8`).
  39 tests in `Affixes.test.ts` / `Stages.test.ts` / `ShipCharacters.test.ts`: rollAffix
  gate (12% base, inclusive boundary, linear chanceMultiplier, **no upper clamp** —
  documented as current behavior), hardcoded weighted-band probes, AFFIX_META integrity +
  tuned weight ladder; stage/ship table integrity (unique ids, finite positive
  multipliers, 24-bit colors, alpha range), unlock-gate syntax locked to what
  `WeaponSelectScene` actually parses, **bidirectional** gate↔`HIDDEN_UNLOCKS`
  consistency (condition exists, `target` + `unlockId` match, every ship/stage-targeting
  condition gates a real entry), registry-mirror weapon-id check, load-bearing
  `ship_default` fallback id, ≥1 ungated ship for the daily pool. Teeth: 7 hand
  mutations — all killed. Found + filed FEAT-SHIP-ACCOUNT-GATE (`account:` gate
  documented but unparsed); fixed stale "8 ships" comment (roster is 11). Pure-data
  content tables now fully locked.
- [x] **TEST-SHOP-ECONOMY** — permanent-upgrade economy math locked (done — `2b5860f`).
  28 tests in `src/data/PermanentUpgrades.test.ts`: `calculateUpgradeCost` (floor
  rounding, Infinity at/past maxLevel, last level finite, every real upgrade's full
  price ladder finite/positive-integer/non-decreasing), `calculateAccountLevel`,
  `getUpgradesByCategory` partition totality, table integrity (unique ids, valid
  categories, positive-integer baseCost, costScaling > 1, maxLevel ≥ 1, getEffect
  total over levels 0..max, icons resolve in `IconMap` without the warn-fallback),
  `getPermanentUpgradeById` round-trip. The "stat field exists" clause translated to a
  **bidirectional shop↔manager id consistency lock** (`PermanentUpgradeState` is
  `Record<string, number>` — untypeable): a `?raw` source scan of
  `MetaProgressionManager.ts` asserts every sold id is consumed
  (`level`/`tieredBonus`/`getUpgradeLevel`) and every consumed id is sold, with a ≥50-id
  extraction-sanity floor so a helper rename fails loudly. Added missing standard
  `src/vite-env.d.ts` (vite/client types) for the `?raw` import. Teeth: 6 hand
  mutations (floor→round, ≥→> guard, sum→count, id rename, icon typo, filter
  inversion) — all killed.
- [x] **FEAT-MENU-NAV-GAPS** — keyboard/gamepad nav for the unwired scenes
  (done — `abf7c58`). `MenuNavigator` nav math extracted to pure
  `src/input/menuNavigation.ts` (`computeNextNavIndex` wrap/clamp/last-row-clamp +
  `resolveHorizontalNav`; 23 tests) and the navigator got its first dispatch tests (19,
  mocked-Phaser fake scene). New API: optional per-item `onLeft`/`onRight` (columns-1
  lists route horizontal input — arrows/AD, d-pad, stick — to the focused item),
  `setEnabled()` (suspend while a modal owns input), and gamepad edge state primed at
  construction (the A-press that opens a confirmation can't instantly activate it —
  latent BootScene confirmation bug, fixed for all navigators). Wired: PactSelectScene
  (flat 5-cards+BEGIN grid; number keys stay; Esc/B = skip-and-begin),
  MusicSettingsScene + AchievementScene (columns-1 zone rows — actions/tabs rows via
  onLeft/onRight, per-card-row items preserve column; scene keydown nav deleted; 'P'
  shortcut kept), SettingsScene (volume/uiScale/segmented zones pad-adjustable;
  reset-confirm overlay suspends the main navigator + gets its own CONFIRM/CANCEL
  navigator). Teeth: 2 hand mutations (last-row clamp, item-routing) both killed; the
  stale-edge bug was caught in self-review and fixed test-first. Feel → playtest queue
  (POLISH-MENU-NAV).
- [x] **TEST-SPATIALHASH** — first coverage for the spatial-query foundation
  (done — `a712b46`). 22 tests in `src/utils/SpatialHash.test.ts`: insert/query radius
  correctness (80px cell-boundary straddling, inclusive radius edge), negative-coord
  cell keys (floor-vs-trunc), `queryInto` append-only buffer semantics, `queryIds`/
  `queryPotential`/`queryPotentialForEach` parity, clear/rebuild + `size`/`cellCount`,
  `findNearest` (strict maxRadius bound — exactly-at-radius is excluded, now locked —
  and excludeId), `findNearestN` (ascending-distance order, excludeIds, count
  truncation), and the `getEnemySpatialHash`/`resetEnemySpatialHash` singleton contract.
  Teeth verified by 5 hand mutations (floor→trunc, `<=`→`<` distance check, cell-loop
  bound, sort removal, reset no-op) — all killed.
- [x] **FEAT-TUTORIAL-HINTS** — one-time contextual tutorial hints (done — `7036e29`).
  New `src/tutorial/`: `TutorialHintManager` (one SecureStorage key `survivor-tutorial-hints`,
  JSON array of seen ids, corruption-hardened load, singleton + test reset) and pure
  `TutorialHints` (defs table + dash-hint outcome `show/defer/dismiss` +
  `findBlockedEvolution` mirroring checkEvolutions threshold math; 27 tests). Five hints
  wired: first-level-up (was dead — gated on `!isTutorialSeen()` which coach marks set true
  at run start), dash-danger (first damage with dash ready; defers on cooldown, silently
  dismissed once the player dashes; touch wording variant), evolution-progress (on upgrade
  pick, names the lagging stat), first-miniboss (reward framing beside the warning banner),
  shop (migrated off `tutorialSeen` — a pre-run shop visit used to set it and silently kill
  the first-run coach marks; `tutorialSeen` now belongs to coach marks only). 'move' hint
  skipped — coach marks already teach movement. Wording/timing feel → playtest queue.
- [x] **FEAT-TELEGRAPH-COVERAGE** — telegraphed Giant stomp + all boss heavy AOEs
  (done — `4f18ac4`). Pure spec module `src/ecs/systems/enemy-ai/telegraphs.ts` (duration
  = windup, ring footprint ≥ damage radius; 23 tests) now holds ALL telegraph geometry —
  the four existing inline call sites (Zigzag/Dasher/Charger/Warden) migrated to it. New
  hookups: Giant stomp ring (88/1.0s), Horde King slam ring (160+phase×30/1.0s), Void
  Wyrm sweep lane (dist+80 overshoot/0.8s) + pre-burst ring (90/0.3s), The Machine laser
  grid (3 beams × 800/1.5s). Zero damage/timing change. **Exploder deliberately excluded**
  — explodes instantly on death, no windup exists; telegraphing needs a fuse delay =
  behavior change → parked as BALANCE-EXPLODER-FUSE (Later, human sign-off). Visual feel
  → playtest queue (POLISH-TELEGRAPH-BOSSES).
- [x] **PROPOSE-UPGRADE-RARITY-TIERS** — rarity-tiered level-up offers biased by luck
  (done — `ea51123`). Pure module `src/data/UpgradeRarity.ts` (3 tiers, weight =
  `1 + clampedLuck × bonus` mirroring Relics.ts, weighted-order sampler); required
  `rarity` on `Upgrade` (multishot epic, piercing + shieldBarrier rare, rest + overflow
  common); optional `luck` param on `getRandomCombinedUpgrades` fed from
  `PlayerStats.luck` at both GameScene call sites; blue/purple card styling + rarity
  sticker in UpgradeScene (gold overflow/mastered wins). 27 new seeded-deterministic
  tests. **Interpretation note:** luck-0 is preserved as *unbiased* (true uniform
  shuffle) rather than bit-identical — the old `sort(() => Math.random() - 0.5)` was an
  approximately-uniform random-comparator sort, so per-stat offer rates shift
  microscopically (strictly fairer). Tuning → playtest queue (BALANCE-UPGRADE-RARITY).
- [x] **TEST-UPGRADE-SELECTION** — level-up offer engine regression-locked
  (done — `c864929`). 36 invariant tests in `src/data/Upgrades.selection.test.ts`
  (selection is random → set-membership/exclusion asserts across 30 rolls per case):
  `10 × level^1.5` XP curve, break gates 3/6/9 (`canLevelUpgrade`/`getBlockingGate`/
  `getBlockingUpgrades`), codex-weighted new-weapon offers (10/+15/+1-per-5-capped),
  milestone-only NEW weapons gated on `canAddWeapon`, banish filtering everywhere, no
  duplicate ids, and the `padWithOverflow` never-dead-level fallback (incl. milestone
  pad-only-when-empty). Teeth verified by 6 hand mutations — all killed.
- [x] **FEAT-COLORBLIND-UI** — colorblind mode + high contrast surfaced in SettingsScene
  (done — `389edef`). 4-segment Colorblind row (Off/Protan/Deutan/Tritan) + High Contrast
  toggle in the VISUALS card, full MenuNavigator/keyboard wiring; pure
  `ColorblindModeOptions` helper (order/labels/index clamping) with 7 unit tests. Both
  `colorblindMode` and `highContrast` were persisted + consumed by `ColorblindPipeline`
  but set by no UI. Gamepad segmented-row gap filed under FEAT-MENU-NAV-GAPS.
- [x] **FEAT-HAZARD-PERSIST** — live hazard zones + spawner pacing persist across
  refresh-recovery (done — `d4bb744`). Optional `hazardState` on `GameSaveState` mirrors
  `shrineState`; `getHazardState()`/`restoreHazardState()` in `HazardZoneSystem.ts`
  (corrupt/tampered entries skipped, pool-capped); legacy saves → reset defaults. 11 new
  tests (save round-trip + module persistence). **Refresh-persistence vein now closed.**
- [x] **CHORE-1** — five empty src dirs removed (done — 2026-06-09 groom; untracked, no commit).
- [x] **CHORE-2** — branch chain resolved (done — verified 2026-06-09: `3db4e75` + `a76fcf4`
  are master ancestors; worktree branches gone).
- [x] **CHORE-3** — swept accessibility files kept + wired (done — verified 2026-06-09;
  remaining UI gap re-filed as FEAT-COLORBLIND-UI).
- [x] **CHORE-4** — bg-isolation note folded into the env note (done — 2026-06-09 groom).
- [x] **PROPOSE-PURE-DATA-TESTS** — pure-data coverage vein **closed** (done — `9a17001`
  Pacts final; DirectorSystem `c0ab86d`, RunModifiers `706e823`, WeaponEvolutions
  `5a00de6`, PerformanceGrade `5940c9a`).
- [x] **Dead-stat vein closed** (done — `2a094e0` luck final; `501b5bc` weaponSynergy,
  `457a755` slowResistance, `4d4386e` chainLightningCount). No write-only PlayerStats
  field remains.
- [x] **Corruption-hardening vein closed** (done — `15cdf16` MusicManager final; every
  SecureStorage loader hardened + tested).
- [x] **Refresh-persistence vein closed** — bounty/shrine/chest/event/stat-buff/evolution/
  consumable/affix/director all round-trip (see archive); hazard zones (`d4bb744`,
  FEAT-HAZARD-PERSIST) then ultimate charge + endless/won state
  (BUG-SAVE-DROPPED-FIELDS, `1f83a3d`+`d58223f`) were the last gaps. Vein now
  genuinely closed (the earlier "closed" claim missed two silently-dropped fields).
