# BACKLOG archive

Completed history moved out of `BACKLOG.md` (groomed 2026-06-09). Newest first.
Active work lives in `BACKLOG.md` — this file is append-only history.

---

## BUG-MENU-FLIP-RESETS-PICKS — rotating the device threw away what you picked · DONE 5dfb3bc

- **Symptom, both scenes.** Rotating the phone mid-selection silently discarded
  half-composed input. In `PracticeScene`, setting up Juggernaut + Caustic Wake @5
  EVOLVED in portrait and rotating to landscape to play snapped all four picks back
  to Sparrow / first weapon / max level / OFF. In `WeaponSelectScene` — the **main
  PLAY path**, not a sandbox — rotating on any of the 3 steps (stage → ship → weapon)
  bounced the player back to step 1, discarding the stage/ship already chosen.
- **Root cause.** `main.ts`'s orientation watcher restarts every live menu scene to
  re-fit the new canvas (`scene.scene.restart(...)`), and neither scene's
  `create()`/`init()` could distinguish that restart from a fresh MAIN MENU entry.
  `PracticeScene.create()` unconditionally reset `selectedWeaponId`, `selectedLevel`,
  `evolvedEnabled`, `selectedShipIndex`; `WeaponSelectScene.create()` unconditionally
  re-entered the 3-step flow at `stage`/`ship`.
- **Why the fix is a flag and not threaded state.** The backlog's original filed
  shape (`BUG-PRACTICE-FLIP-RESETS-PICKS`) proposed passing the four fields through
  the restart, which would have required the watcher to hand each scene its own
  state instead of its original launch payload. That was unnecessary: Phaser
  **reuses the scene instance** across a restart (`shutdown()` → `init()` →
  `create()`, field initializers do not re-run), so `this.selectedWeaponId` and
  friends already survive — the *only* thing destroying them was `create()`'s own
  unconditional reset. So the fix is a single boolean, `relayout`, spread into the
  restart payload (`{ ...launchData, relayout: true }`) alongside the scene's
  original launch data (preserving e.g. `WeaponSelectScene`'s `gauntletMode` across
  a flip). Each scene reads it in `init()` — the only correct place, since a flag
  cleared in `shutdown()` would be gone before `create()` runs — and decides for
  itself what "this is a re-layout, not a fresh entry" means: `PracticeScene` skips
  its four resets; `WeaponSelectScene` resumes the step it was on instead of
  restarting the flow.
- **The `settings.data` stale-payload trap.** Phaser's `Systems.start(data)` only
  assigns `settings.data` when `data` is truthy, so a scene keeps its *last* payload
  when started with none (`node_modules/phaser/src/scene/Systems.js:735-743`).
  `BootScene.ts` already carries a comment about this exact trap and passes
  `{ gauntletMode: false }` explicitly to `startNewGame`. The PRACTICE entry
  (`BootScene.ts:202`) passed no data at all, so after one flip its retained
  `{ relayout: true }` would have leaked `relayoutOnly = true` into the *next* fresh
  PRACTICE entry — picks that should have reset would have stuck. Fixed by applying
  the same idiom: `transitionToScene(this, 'PracticeScene', { relayout: false })`.
  `WeaponSelectScene` needed no equivalent guard — every entry point already passes
  an explicit payload (`{ gauntletMode: false }` or `{ gauntletMode: true }`), so
  `settings.data` is replaced on every fresh entry and `relayout` cannot survive
  into one.
- **Why `renderStep()` dispatches to `render*`, not `proceed*`.** `WeaponSelectScene`
  gained a `renderStep(step)` dispatcher so a resumed flip can re-paint the live
  step directly. It calls `renderStageSelectionStep`/`renderShipSelectionStep`/
  `renderWeaponSelectionStep` rather than `proceedToShipStep`/`proceedToWeaponStep`,
  because the `proceed*` methods open with `clearStepUI()` + `destroyMenuNavigator()`
  (pointless on a scene whose `shutdown()` already ran) and `proceedToWeaponStep()`
  can `scene.start('PactSelectScene')` when ≤1 weapon is discovered — which would
  hijack the flip mid-rotation. The `render*` methods are self-sufficient: each sets
  `this.currentStep` itself, and `renderWeaponSelectionStep` defensively re-registers
  its keyboard handler, so number-key shortcuts survive a flip. This mirrors how
  `goBack()` already dispatches.
- **Scoped out on purpose: `PactSelectScene`.** It has the same class of bug
  (`init()` clears `selectedIds` unconditionally) and sits on the same PLAY path,
  right after `WeaponSelectScene`. Left out because one fact needs verifying first —
  whether a rebuilt pact card (its `create()` rebuilds cards from scratch) actually
  paints its selected badge from a preserved `selectedIds`, or whether it would
  silently desync (state says selected, card renders unselected — worse than the
  original bug). Filed as `BUG-PACTSELECT-FLIP-RESETS-PICKS` with the fix shape and
  the fact to check first.
- **No tests added.** The entire fix is a boolean threaded through the Phaser scene
  lifecycle (`init`/`create`); there is no pure function to pin, and this repo
  exercises Phaser-coupled code by mocking its module boundary rather than driving a
  live scene (`CLAUDE.md`) — a test that mocked the boundary here would assert
  nothing but the mock. `tsc --noEmit` plus a human rotate (filed as
  `POLISH-MENU-FLIP-STATE`) are the real gates.

---

## BUG-PRACTICE-PORTRAIT — fit the practice menu to a phone in portrait · DONE a802fcd

- **Value:** `PracticeScene` was the only menu scene that never opted into the
  orientation-matched 720×1280 design fit — `grep -il 'orientation|portrait'` over
  `src/` hit every other menu scene (BootScene, SettingsScene, ShopScene, CardsScene,
  WeaponSelectScene, PactSelectScene, AchievementScene, CreditsScene, RunnerScene,
  UpgradeScene, GameScene, HUDManager, PauseMenuManager, ToastManager) but not
  `PracticeScene.ts`. On a phone held in portrait — the default orientation — the
  six-fleet-session practice sandbox (`FEAT-PRACTICE-MODE`, `-BOSS`, `-BUILD`, `-TIME`,
  `-ULT`, `-SHIP`), and the tool the entire `POLISH-PRACTICE-*` playtest queue depends
  on, **could not be started at all**.
- **Two distinct defects, both fixed:**
  1. **Wrong scale function.** `renderHeader()`/`renderControls()` called only
     `computeMenuLayoutScale` (the LANDSCAPE fit). On the 720×1280 portrait canvas that
     resolves to `min(1, 720/1280, 1280/720) = 0.5625`, shrinking the whole menu and
     landing START at y=1291…1343 — entirely below the 1280-unit canvas (its centre
     sits 37 units past the bottom edge). Fixed with a new `computeScales()` private
     method that picks `computeMenuLayoutScalePortrait`/`computeMenuFontScalePortrait`
     when `this.scale.height > this.scale.width`, exactly as `BootScene` already does.
     Under EXPAND's orientation-aware base (portrait guarantees ≥720×1280) that fit
     also resolves to exactly 1.0, so the menu renders full size in either orientation
     — this is a pure no-op in landscape.
  2. **The bottom reserve was short in *both* orientations, by a constant.** The stack
     reserved `130` units below the stepper (`rowY = height - scaledInt(layoutScale,
     130)`) but the stack below it needs `50` (EVOLVED) `+ 60` (START) `+ 26` (START's
     own half-height) `= 136`. Landscape today: `startY = 700`, extent 674…**726** on a
     **720**-unit canvas — a 6-unit overhang on every device, in every orientation,
     that fixing (1) alone would have left in place. New reserve constant
     `PRACTICE_CONTROL_BOTTOM_RESERVE = 140` closes it with 4 units to spare in both
     orientations.
- **Before/after (both at `layoutScale = 1.0`, the value on every real device):**

  | canvas | `startY` before | `startBottom` before | `startY` after | `startBottom` after |
  |---|---|---|---|---|
  | landscape (720 tall) | 700 | 726 (over by 6) | 690 | 716 (clears by 4) |
  | portrait (1280 tall) | 1317 | 1343 (over by 63) | 1250 | 1276 (clears by 4) |

- **Shipped as a pure helper, not inline arithmetic.** The stack math moved to
  `computePracticeControlLayout(canvasHeight, layoutScale)` in `HudScale.ts` — the
  repo's existing home for scene-specific pure layout math (`computeRowStackFit`'s
  docstring already names the practice dock). It is the only home a Node test can
  import: `PracticeScene.ts` imports Phaser at module top and cannot be imported by a
  Node test. Two tests in `HudScale.test.ts` pin the invariant — `startBottom` never
  exceeds the canvas height in either base shape, and the reserve covers the whole
  stack below the stepper — so this scene's recurring failure mode (every practice
  feature to date has added a row, and START is the one that silently renders past the
  edge) fails in CI instead of on a real device.
- **Deliberately not touched — the vertical-budget trap.** `PracticeScene` draws its
  buttons at raw, unscaled sizes (`width: 220`, `height: 36`, START `height: 52`) while
  its *positions* go through `scaledInt(layoutScale, …)`. That mismatch is
  pre-existing and harmless because `layoutScale` is exactly 1.0 in both orientations
  on every real device, so scaled and unscaled agree — scaling the button dimensions,
  touching `computeGridLayout()`/`renderWeaponGrid()` (the 5×4 portrait weapon grid
  already fits, y 267…743), or adjusting font sizes (`computeMenuFontScalePortrait`
  caps its density term at 1.2, below landscape's 1.6, so portrait text is smaller than
  what already shipped) were all out of scope and left alone. The single exception:
  START's literal `height: 52` now reads `PRACTICE_START_HEIGHT` so it cannot drift
  from the helper's `startBottom` — same value, single source of truth.
- **Found while reading the fix, filed but not fixed:**
  **BUG-PRACTICE-FLIP-RESETS-PICKS** — `main.ts`'s orientation watcher
  (`main.ts:169-178`) restarts live menu scenes on a flip via
  `scene.restart(scene.sys.settings.data)`, which re-runs `PracticeScene.create()` —
  and `create()` deliberately resets the four practice picks (weapon, level, evolved,
  ship) to defaults, correct for a fresh menu entry but wrong for a mid-setup rotation.
  Pre-existing and orientation-symmetric, but now far more likely to be hit: setting up
  in portrait and rotating to play in the game's native landscape is the natural flow
  this fix newly enables. Filed under `## Later`; fix shape needs `main.ts` to hand the
  scene its own state through the restart rather than the original `settings.data`, so
  it is out of this fix's one-scene scope.
- **Playtest filed, not resolved blind:** `POLISH-PRACTICE-PORTRAIT` under
  `## Human gates` — no browser available this session; the on-device read (does the
  ~260-unit dead band between the grid and the SHIP row feel like breathing room or
  brokenness, does the 5×4 grid still feel tappable) is the human's call.

---

## FEAT-PRACTICE-SHIP — pick the ship you practise as · DONE e0f72e7

- **Value:** `PracticeScene.startPractice()` passed a literal `shipId: 'ship_default'`,
  so every sandbox run flew Sparrow no matter what was picked on screen.
  `selectedShipId` is the single key for all four ship axes — six stat multipliers +
  8 signature fields + ship mods (`GameScene.ts:1034-1090`), the hull silhouette
  (`getShipHullId()`), the neon palette (`getShipNeonColor()`), and, since
  FEAT-SHIP-ULTIMATES (`49c934f`), the ultimate `activateUltimate()` resolves — so
  every one of those axes was being judged through Sparrow's numbers regardless of
  which ship the description on screen named. The parked playtest
  BALANCE-SHIP-ULTIMATES literally asks George to "fly Juggernaut then Scholar", two
  ships the sandbox could not fly at all.
- **Shipped:** the PRACTICE menu gained a `SHIP` row — a 220-wide cycle button, plus
  two muted lines naming the picked ship's description and its ultimate — sitting
  above the LEVEL stepper. `startPractice()` now passes
  `(SHIP_CHARACTERS[this.selectedShipIndex] ?? getDefaultShip()).id` instead of the
  literal. That one id passthrough is the whole feature: every other axis was already
  wired and needed zero new code, including the dock's existing `ULT: SHIP` row,
  which now resolves to the ship you picked, for free, because
  `activateUltimate()` was already reading
  `this.practiceUltimateOverride ? getShipUltimate(...) : getUltimateForShip(getShipById(this.selectedShipId) ...)`.
- **All 11 ships, including locked ones — deliberate, not an oversight.**
  `WeaponSelectScene.getAvailableShips()` filters by `isUnlockRequirementMet`;
  practice does not, for four reasons: (1) **scene precedent** —
  `PRACTICE_WEAPON_IDS` already offers all 19 weapons with no gate check, so ships
  gating would contradict the scene's own weapon axis; (2) **nothing persists** —
  `setPracticeSession(true)` makes `SecureStorage` drop every write for the session,
  so no progression is bypassed; (3) **9 of 11 ships are `hidden:` gated**, including
  Juggernaut and Scholar, the exact pair BALANCE-SHIP-ULTIMATES names — gating the
  picker would strand a fresh profile on Sparrow, i.e. today's behaviour; (4)
  `GameScene` never re-validates the incoming `shipId` against unlocks
  (`GameScene.ts:548`), so passing any id already worked.
- **Cycle button, not a card grid or a ◀▶ stepper — forced by the vertical budget and
  the label width.** `computeMenuLayoutScale` resolves to exactly `1.0` under
  Phaser's EXPAND-mode landscape guarantee (≥1280×720), so the canvas is a fixed 720
  units tall. Measuring the existing stack: the weapon grid ends at y=402, the LEVEL
  stepper starts at y=572 (`rowY = 720-130`), EVOLVED at 640, and START already
  overhangs the 720-unit canvas by 6 units at y=700-726 — there is no room below. The
  402…572 free band (170 units) is the only place a new row fits, big enough for one
  36-tall button plus two text lines but not a card grid. A ◀▶ stepper (LEVEL's
  pattern) doesn't fit either: LEVEL's value sits in ~84 units between its arrows,
  fine for `12`, an overflow for `GLASS CANNON`. The 220-wide cycle button matches the
  adjacent EVOLVED toggle's geometry and the dock's already-shipped `ULT:`/`MUTATOR:`
  row behaviour (12- and 8-entry cycles). At worst-case phone `fontScale` (1.6), a
  bare ship name like `GLASS CANNON` (12 ch, ~182px) fits the 220-wide button
  (~204px usable), but prefixing it `SHIP: GLASS CANNON` (18 ch, ~274px) overflows —
  which is why `SHIP` is a separate label to the button's left, mirroring the LEVEL
  row exactly.
- **The now-false docstring.** FEAT-PRACTICE-ULT's `PracticeUltimates.ts` comment
  said practice "always starts ship_default … so Overdrive is the only one of the 11
  ultimates the sandbox could otherwise ever fire" — this feature falsifies that.
  Docstring rewritten to describe the override in terms of *this* feature (`null` =
  fly whichever of the 11 ships the menu picked) rather than the old ship_default
  constraint.
- **Left for the human, not fixed blind:** the ship description strings end
  "Starts with Ground Spike." (etc.) but practice's `!practiceModeActive` guard in
  `GameScene.ts:1071` deliberately keeps the *weapon grid's* pick, not the ship's own
  starting weapon — so the description can read as contradicting what's on screen.
  Left the data untouched rather than mangle shipped strings; whether it misreads in
  practice, and whether locked ships belong in the sandbox at all, are filed as
  playtest checks (b) and (d) under **POLISH-PRACTICE-SHIP** (`## Human gates`).
  Also found while measuring the layout, filed but not fixed: **BUG-PRACTICE-PORTRAIT**
  — `PracticeScene` uses the landscape layout-scale function even on a portrait
  canvas, so `START` overhangs by 37 units there; pre-existing, not a regression from
  this row (which sits entirely above the stepper).

---

## FEAT-PRACTICE-ULT — fire any ship's ultimate on demand from the practice dock · DONE 9288a23

- **Value:** FEAT-SHIP-ULTIMATES (`49c934f`) shipped 11 distinct ultimates whose feel
  only a human in a browser can judge, and the filed playtest **BALANCE-SHIP-ULTIMATES**
  asks George to compare them — but charging the meter takes ~40 kills per shot
  (`ULTIMATE_CHARGE_PER_KILL = 2.5` into `MAX_ULTIMATE_CHARGE = 100`), so answering it
  the honest way cost eleven full runs. The `ship_default` finding made it non-optional:
  `PracticeScene.ts` hard-codes `shipId: 'ship_default'` on the run it starts, and the
  default ship's `ultimateId` is `'overdrive'` — so practice could only ever fire
  Overdrive, 10 of the 11 new ultimates were unreachable in the sandbox at all.
- **Shipped:** a new derived cycle, `src/data/PracticeUltimates.ts`
  (`PRACTICE_ULTIMATE_CYCLE` = `SHIP` + all 11 `SHIP_ULTIMATES` entries,
  `practiceUltimateLabel()`, `nextPracticeUltimate()`) so the cycle can never drift out
  of sync with the registry. The dock gained two rows: `ULT: <NAME>` (cycles `SHIP` →
  all 11, magenta when overridden) and a gold `FIRE ULT` button (also the `U` key).
  `GameScene.activateUltimate()` now resolves `practiceUltimateOverride` before falling
  back to `getUltimateForShip()` — the only two lines that changed in that method — so
  the toast, nova, statuses and everything else downstream is unmodified and announces
  the override for free.
- **Why `fillUltimateCharge()` instead of `addUltimateCharge(MAX_ULTIMATE_CHARGE)`** (the
  backlog entry's original suggestion): `addUltimateCharge()` is a no-op while
  `chargeSuppressed`, and it scales its input by `chargeRateMultiplier` — under a sub-1
  multiplier, `addUltimateCharge(100)` would under-fill and the fire would silently
  no-op. A practice button must be exact, so `UltimateSystem.ts` gained one new export
  that assigns `charge = MAX_ULTIMATE_CHARGE` directly, bypassing both.
- **The fit-to-height trap:** the dock is a fixed vertical stack of equal rows, centered
  in the canvas, with no fit clamp. Phaser runs in EXPAND mode, so the canvas stays
  ~720 game units tall while `hudScale` climbs to ~2.09 on an iPhone landscape viewport.
  Naively going from 8 rows to 10 pushed the natural stack from 595 to 747 units — over
  the 720-unit canvas, and because the stack is centered it overhung *both* edges,
  clipping `SPAWN` off the bottom and the first row off the top. The fix mirrors
  `BootScene.ts`'s existing fit-to-width deck-row shrink as a fit-to-height twin:
  `computeRowStackFit(rowCount, rowHeight, gap, availableHeight)` in `HudScale.ts`,
  pinned by 3 new cases in `HudScale.test.ts`.

  | hudScale | design H/Gap | natural | available | fit | final H/Gap | final stack | fits? |
  |---|---|---|---|---|---|---|---|
  | 1.0 (desktop) | 30 / 6 | 354 | 704 | 1.0 | 30 / 6 | 354 | yes — desktop byte-for-byte unchanged |
  | 2.09 (iPhone) | 63 / 13 | 747 | 686 | 0.918 | 57 / 11 | 669 | yes |
  | 4.0 (max UI scale) | 120 / 24 | 1416 | 656 | 0.463 | 55 / 11 | 649 | yes |

- **Tuning knobs:** `PRACTICE_ULTIMATE_CYCLE` (`src/data/PracticeUltimates.ts`) for the
  cycle order/labels; the row order and the fit constants in `PracticeDock.build()`
  (`src/ui/PracticeDock.ts`) for the dock layout.
- **Known limit, filed for next session:** practice still flies `ship_default`, so an
  overridden ultimate fires with Sparrow's stats (the nova scales with
  `playerStats.damageMultiplier`) — absolute damage reads Sparrow-flavoured even though
  the ability itself is correct. Filed as **FEAT-PRACTICE-SHIP**. Playtest follow-up
  filed as **POLISH-PRACTICE-ULT** under `## Human gates`.

---

## FEAT-SHIP-ULTIMATES — every ship gets its own ultimate · DONE 49c934f

- **Value:** the Overdrive meter (Q / gamepad Y / the touch ult button) fired one
  identical screen-clearing nova on all 11 ships — the game's biggest, most-pressed
  button was the only ship identity axis that was still completely flat, while hull
  silhouette, neon palette, the six stat multipliers and the signature stat-bonus
  fields already differed per ship.
- **Shipped:** a new pure registry, `src/data/ShipUltimates.ts`
  (`ShipUltimateId`, `ShipUltimateDefinition`, `SHIP_ULTIMATES`, `getShipUltimate()`,
  `getUltimateForShip()`), giving each ship its own `ultimateId`
  (`ShipCharacters.ts`). `GameScene.activateUltimate()` was rewritten from a hardcoded
  nova into a generic applier: it resolves the flown ship's ultimate, fires the shared
  `computeUltimateNova()` scaled by the ultimate's `radiusMultiplier`/`damageMultiplier`
  and its own `knockback`, then lands any `freeze`/`burn`/`poison` on survivors still
  alive inside the blast (mirroring `detonateArea`'s own `EnemyTag && Health.current > 0`
  filter), applies any heal/iframe/slow-time/stat-buff, and shows a 2.2s toast naming
  the ultimate. `WeaponSelectScene`'s ship card now appends `ULT — <name>: <description>`
  to `ship.description` (the block grows downward with nothing below it, so no layout
  work was needed).
- **The 11-ship mapping:**

  | Ship | Ultimate | What it does |
  | --- | --- | --- |
  | Sparrow (`ship_default`) | Overdrive | Baseline screen-clearing nova — byte-identical to the pre-feature behavior. |
  | Interceptor | Temporal Rip | 8s of 75%-speed slowed time, plus a light blast. |
  | Dreadnought | Siege Pulse | Short, very heavy (×2.0 dmg, 0.6 radius) blast; repairs 25% HP. |
  | Scholar | Insight Surge | x3 XP and x2 gem value for 12s, minimal blast. |
  | Juggernaut | Bulwark Slam | Massive 1,200-knockback shockwave; 2s invulnerable. |
  | Void Walker | Void Collapse | Blasts, then freezes every survivor for 5s. |
  | Boss Hunter | Execution Mark | Ignites every survivor with a heavy 10s burn. |
  | Flawless | Pristine Aegis | Full HP repair and 3s invulnerable. |
  | Glass Cannon | Critical Cascade | x2.5 damage for 10s, minimal blast. |
  | Elite Slayer | Culling Field | Blast plus max (10) poison stacks on every survivor. |
  | Apex | Apex Ascendance | Wider/heavier nova, x1.8 damage for 10s, repairs 30% HP. |

- **Design:** `UltimateSystem.ts` (charge, suppression, save/restore,
  `computeUltimateNova` scaling) was deliberately left untouched — it is already
  correct and unit-tested, and per-ship variation rides on top purely as multipliers,
  so central nova tuning still reaches every ship and Sparrow is unchanged from today.
  `shieldCharges` was deliberately excluded from every ultimate: it is gated behind
  `playerStats.shieldBarrierEnabled`, so granting charges would have been a silent
  no-op for any player without the Shield Barrier upgrade — the exact "advertised but
  dead" bug class the last five sessions were spent removing. The two defensive
  ultimates (Bulwark Slam, Pristine Aegis) grant `damageCooldown` iframes instead,
  which always work regardless of upgrades. No save-schema change was needed — the
  ultimate derives from `selectedShipId`, already persisted, and timed stat buffs
  already round-trip through `timedDamageBuffs`.
- **The 11 number sets (nova multipliers, statuses, durations) are a human tuning
  knob**, set by ship identity rather than by play — they go to the playtest queue as
  **BALANCE-SHIP-ULTIMATES** rather than being retuned blind.

---

## FEAT-META-MEMORY — Memory (`upgradeKeepLevel`), the last paid dead getter · DONE f3ba7ce

- **Value:** Memory is a 2,000-gold shop upgrade (500 base, ×3.0 scaling, max level
  2, unlock level 20) whose card reads *"Keep {level} lowest upgrades"*.
  `getStartingUpgradeKeep()` (`MetaProgressionManager.ts:987`) had **zero callers** —
  it took the gold and did nothing. It was the last of the class this and the prior
  three sessions worked through: `9b520d0` (Vitality/Fortify heals landed on a
  mirror field), `1443893` (three placebo shop upgrades, ~13,500 gold), `48400ec`
  (Blessing, 3,900 gold, zero callers), `8184fac` (every run starting at 100 HP
  regardless of max). Unlike those, Memory was an **unbuilt feature**, not a loose
  wire — it needed cross-run upgrade persistence, which is why it outlived the rest.
- **Shipped:** a new pure module, `src/data/KeptUpgrades.ts`, with `recordRunBuild()`
  (bank every owned, non-overflow upgrade and its level) and `selectKeptUpgrades()`
  (the N lowest-level entries of a banked build). Both run-end paths —
  `showVictory()` and `gameOver()`, the same pair that already dual-calls
  `recordAchievements` because victories never flow through `gameOver()` — now call
  `metaManager.recordRunUpgrades(recordRunBuild(this.upgrades))` to bank the
  finished run's build to a new meta storage key
  (`survivor-meta-last-run-upgrades`, registered in `StorageBootstrap.ts`). The next
  run's start block reads `selectKeptUpgrades(getLastRunUpgrades(),
  getStartingUpgradeKeep())` and replays `upgrade.apply()` once per level for each
  kept entry — the same shape `applyPracticeBuild` already uses — then toasts what
  carried over.
- **Design:** (a) eligibility is `!upgrade.isOverflow && upgrade.currentLevel > 0`,
  **not** `isStatUpgrade` — that flag means "subject to break-level gates" and is
  false for `shieldBarrier`, a legitimate keepable upgrade, and also false for every
  Limit Break overflow upgrade. Overflow entries are excluded on their own terms:
  Memory keeps the **lowest** upgrades, and overflow scraps sit at level 1–3 beside
  a maxed late-game build, so an unfiltered implementation would hand out overflow
  crumbs every single time — to the only players who can afford a 2,000-gold
  upgrade. A test pins this because the wrong filter is the natural-looking one. (b)
  the **whole** owned build is banked, not the pre-selected carryover, because the
  keep count is read at run start: buying Memory (or its second level) after a run
  ends still pays out on the run already banked, instead of costing 500 gold for
  nothing until one more run has been played. (c) the block is placed with the other
  run-start gifts, immediately after blessings and ahead of the SHIP block — a kept
  Vitality's flat HP is hull-scaled the way a card's `maxHealthAdd` is, and the SHIP
  block's unconditional `currentHealth = maxHealth` then fills the new headroom, so
  no health code was needed and no risk of the `9b520d0`/`8184fac` class of bug. (d)
  the HUD icon strip reads `currentLevel` off `this.upgrades`, so kept upgrades
  appear for free — no HUD code written. (e) `selectKeptUpgrades(_, 0)` returns
  `[]`, so a profile that never bought Memory is byte-identical — the same
  load-bearing guard `48400ec` used for `selectBlessings(0)`. (f) the record is meta
  state, not run state — no `GameStateManager` schema change; a restored run never
  replays `create()`'s pipeline, so it can't double-apply Memory. (g) the loader
  rebuilds the stored array entry by entry and clamps each level to
  `MAX_RECORDED_UPGRADE_LEVEL` (10), since a tampered level both cheats stats and
  drives a hot replay loop; the run-start block's own `Math.min` against
  `upgrade.maxLevel` is the second bound.
- **Open knobs (for the human, not a playtest):**
  - **Carryover magnitude.** Memory pays out *inversely* to build breadth: a player
    whose build is broad and shallow keeps two level-1s (near-nothing), while a
    maxed late-game player whose whole build sits at 10 keeps **two level-10s** —
    including a possible Might 10 (+50% damage) from t=0. "Lowest" is the card's
    literal promise and is anti-snowball by design, but its payout curve is not
    flat, and the ceiling is the human's call to keep, cap, or retune.
  - **Daily fairness.** Memory applies in daily/weekly challenge runs, consistent
    with every other meta upgrade (blessings, Fortitude, ships) — but daily runs are
    a leaderboard, so whether *any* meta should apply there is a standing question
    this feature makes slightly sharper.
  - **No playtest filed:** the behavior is provable from the diff plus the pinned
    pure logic, and the `## Human gates` playtest queue is already ~30 deep with
    none ever drained.

---

## BUG-RUNSTART-HP-CAP — every run started at 100 HP no matter your max · DONE 8184fac

- **Value:** run-start HP was hard-capped at 100. `createPlayer`
  (`GameScene.ts:5675`) seeded `Health.current/max = 100/100`; the only thing that
  runs after it, `syncStatsToPlayer`, does
  `Health.current = min(Health.current, maxHealth)` — downward-only, which is right
  mid-run (new max HP must not heal you) and wrong at run start, where the only thing
  to clamp against is the placeholder. So every profile whose final max HP passed 100
  started every run short, and the shortfall **grew with the investment**: maxed
  Fortitude (**1,992 gold** — 60 base ×1.25, ten levels) on a neutral ship started
  **100/165**; on the Juggernaut, whose headline identity is "+75% HP", **100/289** —
  **65% of the paid-for health missing at t=0**, recoverable only from pickups. The
  threshold is Fortitude 4 (345 gold cumulative) on a neutral ship, and **Fortitude 1
  (60 gold)** on the Juggernaut. It silently taxed Fortitude, every ship's
  `healthMultiplier`, ship mods' `maxHealthMult`, achievement HP rewards, card and
  boost `maxHealthAdd`, and last session's `blessed_vigor` (+25% max HP, `48400ec`).
  The HUD reads the ECS (`currentHP: Health.current[this.playerId]`), so a maxed tank
  saw `100/289` on the bar.
- **Shipped:** `createPlayer` now seeds the component from the built stats
  (`Health.current = playerStats.currentHealth`, `Health.max = playerStats.maxHealth`)
  instead of `100/100` — exactly what `restorePlayer` (`GameScene.ts:2254`) has always
  done under the comment *"Restore health from playerStats (more reliable than entity
  data)"*. `syncStatsToPlayer`'s clamp then no-ops at run start (current === max) and
  mid-run semantics are untouched. Two lines; `createPlayer` has a single call site.
- **Design:** (a) the run-start pipeline had been stating the intent **six times** —
  every block that raises max health (meta Fortitude 839, cards 926, armed boost 952,
  ship multiplier 998, ship mods 1043, achievement HP 1083) follows it with
  `playerStats.currentHealth = playerStats.maxHealth`, and **none** of those writes
  ever reached the ECS, because `playerStats.currentHealth` is only a lagging mirror
  of `Health.current`; (b) seeded from `currentHealth` rather than `maxHealth` to
  mirror `restorePlayer` — the six pipeline writes guarantee they are equal at that
  point, so it starts full today while staying correct if a run ever needs to start
  damaged; (c) **`syncStatsToPlayer` was deliberately left alone** — its downward-only
  clamp is load-bearing mid-run and `grantBuildHeal` exists precisely to work with it;
  "fixing" the clamp would heal the player every time max HP grew mid-run, the
  opposite bug; (d) health is the **only** leaking field — every other stat the sync
  pushes is an unconditional assignment, so the `Velocity.speed = 200` placeholder is
  harmless and was left; (e) this is the second half of BUG-VITALITY-HEAL-DEAD
  (`9b520d0`), which found this exact clamp but only fixed **mid-run** grants via
  `grantBuildHeal`; (f) `applyPracticeBuild` (~5014) had already hit this and patched
  it **for practice mode only**, with the comment *"syncStatsToPlayer only clamps
  current HP downward, so vitality's new headroom starts empty"* — that line stays
  correct and untouched.
- **Open knob (for the human, not a playtest):** this makes the game **meaningfully
  easier for developed profiles**, because they now start with the health they bought
  — a maxed-Fortitude Juggernaut goes from 100 to 289 starting HP, ~2.9× the early-run
  survivability it has had until now. That is a restoration of advertised value, not a
  buff (same upward-only class as `9b520d0` / `1443893`, and unlike
  BUG-BLOOD-PACT-HALVE-DEAD, which is parked precisely because it makes the game
  *harder*). But the game's difficulty curve was tuned, knowingly or not, against
  players who started at 100. Whether early-run enemy pressure now needs raising is a
  balance call the human owns. Knobs: `maxHealth` in `createDefaultPlayerStats()`
  (`Upgrades.ts:152`), `healthLevel`'s `baseCost`/`costScaling`
  (`PermanentUpgrades.ts:220`), each ship's `healthMultiplier`
  (`ShipCharacters.ts`), and the world-level enemy scaling in `MetaProgressionManager`.
- **Why no playtest was filed:** the playtest queue stands at ~30 items and has never
  had one drained, so a 31st entry is pure operator load. The fix is provable from the
  diff without a browser (the ECS seed is the only writer of run-start HP, and
  `createPlayer` has exactly one call site), and its visible effect — the health bar
  starting full instead of at 100 — is self-evident the first time the human plays.
  The difficulty question above is recorded as a knob instead.

## FEAT-META-BLESSING — the 3,900-gold shop upgrade that did nothing · DONE 48400ec

- **Value:** Blessing (`blessingLevel`, 400 base ×2.5, max 3 = **3,900 gold**)
  advertised "Random bonus each run" / "{level} random blessing(s)" and did nothing —
  `getStartingBlessingCount()` had **zero callers**. Found by the same audit that
  shipped BUG-META-DEAD-RESOURCES (`1443893`); a caller-count sweep over every getter
  in `MetaProgressionManager` leaves **Memory** (`upgradeKeepLevel`, 2,000g) as the
  only paid dead getter still standing.
- **Shipped:** new `src/data/Blessings.ts` — 14 pure-upside blessings in the
  `RunModifiers`/`Pacts` `apply(stats)` shape, plus `selectBlessings(count)` and
  `getBlessingById`. `GameScene` rolls `getStartingBlessingCount()` of them right
  after the pacts block, applies them, and toasts them; they render in the HUD
  relic/modifier strip with per-blessing icon, colour and tooltip; the pause panel
  gets a `Blessing N` line beside the existing `Curse` line; `blessingIds` persists
  in the save.
- **Design:** (a) a blessing is **pure upside** — that is what separates it from a
  RunModifier (tradeoff) and a Pact (bought curse) — and a test pins that no entry
  worsens any stat; (b) `selectBlessings(0)` returns `[]`, so an unbought profile is
  byte-identical — the `count <= 0` guard is load-bearing because `slice(0, -1)`
  would otherwise return nearly the whole pool; (c) blessings re-roll every fresh run
  and are **not** carried in the PLAY-AGAIN scene payload, because "random bonus each
  run" means each run; (d) `blessingIds` is **display-only on restore** — saved
  `playerStats` already has the effects baked in, so re-applying on reload would
  double them (same contract as `pactIds`); (e) `blessingIds` is an optional save
  field with no `SAVE_VERSION` bump, matching how `pactIds`/`relicIds` were added —
  the validator deliberately leaves newer optional fields unguarded; (f) the pool is
  registered in `referentialIntegrity.test.ts`'s icon sweep, the existing guard
  against a dangling icon key silently rendering the cross-mark fallback.
- **Open knob (for the human, not a playtest):** the pool's magnitudes (+20% damage,
  +25% max HP, +1 revival, …) were set against the RunModifier pool — a RunModifier
  gives +50% damage *with* a downside, so a pure-upside gift was pitched lower at
  +20%. Whether 3 random blessings are worth 3,900 gold, and whether `blessed_resolve`
  (+1 revival) is too swingy against `blessed_magnetism` (+50 pickup range), are
  balance calls the human owns. Knobs: the `apply` factors in `src/data/Blessings.ts`
  and `baseCost`/`costScaling` at `PermanentUpgrades.ts:769`.
- **Why no playtest was filed:** the playtest queue stands at ~30 items and has never
  had one drained; the wiring is provable from the diff and the unit test (the getter
  now has a caller; an unbought profile provably rolls nothing), so a 31st queue entry
  would be pure operator load. The balance question above is recorded as a knob instead.

---

## BUG-META-DEAD-RESOURCES — three shop upgrades took gold and did nothing · DONE 1443893

**Value:** Fortune (`dropRateLevel`, "+5% drop rate"/level, ~4,470g for 5 levels),
Scavenger (`healthDropLevel`, "+20% health drop rate"/level, ~3,390g for 5 levels)
and Boss Slayer (`bossGoldLevel`, "+50% boss gold"/level, ~5,590g for 5 levels) —
~13,500g combined — all sit in `resources`, the shop category bought specifically
to earn more, yet each field was declared, initialized to `1.0`, written once at
`GameScene.ts:864-866` (from a meta getter) and read **zero** times anywhere in
`src/`. The three upgrades were pure placebo.

**Shipped:** `healthDropMultiplier` now scales the enemy-death health-pickup roll;
`dropRateMultiplier` now scales the enemy-death floor-consumable roll;
`bossGoldMultiplier` now scales a boss's gold cache via a new `sourceXpValue`
parameter on `spawnRandomConsumable`.

**Design:** (a) all three multipliers are `1.0` at zero levels, so an unbought
profile is byte-identical — the fix connects a wire, it does not retune anything;
(b) `dropRateMultiplier >= 1` always, so the boss guaranteed-power-up cannot break
and needs no clamp; (c) **there is no per-boss gold award in this game at all** —
every `addGold` site was traced, and a boss's guaranteed consumable rolling
`GOLD` (20%) is the only gold a boss produces, so that cache is the only thing
"+50% boss gold" can scale; (d) only the 2 enemy-death `spawnRandomConsumable`
sites pass a source tier — crate/shrine/bounty keep the `0` default; (e) Fortune
scales the consumable roll only, since health pickups have their own upgrade
(Scavenger) and gems are guaranteed.

**Open knob (for the human, not a playtest):** Boss Slayer maxed is ×3.5 on a
cache worth `25 + gameTime*0.5 + worldLevel*10` (≈335g at the 10-minute boss),
dropped by 20% of bosses — expected ≈ +185g per boss against a 5,590g price. That
price/payoff ratio is a balance call the human owns; the knobs are `baseCost` /
`costScaling` at `PermanentUpgrades.ts:591` and the `0.5` per-level magnitude at
`MetaProgressionManager.ts:971`.

**Why no playtest was filed:** the playtest queue stands at ~30 items and has never
had one drained; the wiring here is provable by reading the diff (the field is now
referenced at the one correct site) and needs no human in a browser, so a 31st
queue entry would be pure operator load. The balance question above is recorded as
a knob instead.

---

## FEAT-PRACTICE-TIME — set the arena's clock, cycle, and mutator on demand · DONE 8452234

**Value:** the three named mutator questions in POLISH-ENDLESS-MUTATORS — (c)
"SWIFT SWARM on cycle-5+ tightened cadence", (d) "VOLATILE AIR elite soup", (g)
"IRON HORDE vs late-run DPS" — were not merely expensive to reach, they were
effectively **unanswerable**: win a full run, survive ~25 more minutes to
endless cycle 5, **and** have the one specific mutator you want come up on a
random roll that explicitly excludes repeats. Practice already scaled a
boss-tier spawn to its canonical time, but the arena around it was still t=0 —
no trash density, no scaling, no endless cycle — so even a perfect spawn
target couldn't answer an endless-arena question.

**Shipped:** `src/data/PracticeArena.ts` (new) plus two PRACTICE dock rows —
ARENA and MUTATOR — and two new `GameScene` methods, `applyPracticeArena` and
`setPracticeMutator`, wired through the dock's callbacks. Three practice
guards close the new reach this unlocks: the achievement time-tracker no
longer credits a jumped clock, the endless cycle loop keeps the
operator-picked mutator instead of re-rolling it, and a practice cycle never
claims a best-cycle record.

**Design:**
- **Two rows, not the one `BACKLOG.md` originally called for.** `BACKLOG.md`
  described "a dock row that sets the run clock", but
  `rollEndlessMutator(previous)` (`src/data/EndlessMutators.ts`) is a uniform
  random roll excluding the previous mutator — a clock alone could only ever
  reach a *random* mutator, never the specific one a question names. The
  backlog's own value sentence names three specific mutators, so a MUTATOR
  picker was required for the item to answer the question its rationale asks.
- **ARENA ratchets one-way; MUTATOR wraps freely.** ARENA compounds
  irreversible state — spawned waves, multiplied escalation — exactly like
  BUILD, so it copies BUILD's `if (index >= length - 1) return; index++`
  shape and greys out at the top rung. The mutator is a single field read at
  spawn time with nothing it could un-apply, so it cycles like the AFFIX rows
  instead.
- **The clock ladder stops at 600, then the last two rungs deepen the cycle
  instead.** `getScaledStats` (`src/enemies/EnemyTypes.ts`) has no upper bound
  on enemy stat scaling, but the spawn-interval curve clamps at phase 3
  (`Math.min(progress, 1)`) and `batchThresholds` maxes at t≥480 — so trash
  *density* is already maxed at t=600, and a rung past it would add nothing a
  cycle rung doesn't do better. Past 600, only the endless cycle escalates.
- **A clock jump suppresses the spawn cascade it would otherwise trigger.**
  `checkMinibossSpawns` fires every unspawned entry whose time is at or below
  `gameTime`, and `checkBossSpawn` fires once `gameTime >= bossSpawnTime`;
  practice does not gate this schedule. A naive `this.gameTime = 600` would
  dump all five minibosses and the boss into the arena at once, burying the
  target the dock exists to spawn on demand — so `applyPracticeArena` marks
  every skipped entry `spawned = true` and `bossSpawned = true` first.
  `recordTimeSurvived` needed the same guard: it completes every milestone at
  or below the value passed, so crediting a jumped clock would complete the
  whole time ladder in one tick and bury the screen in toasts — practice now
  skips that tracker entirely (its writes already no-op regardless).
- **The per-cycle ramp constants are duplicated from `checkEndlessModeSpawns`
  rather than extracted into shared tuning.** Extracting `1.25 / 1.15 / 1.1`
  would mean editing the live endless path for zero operator-visible gain.
  Keeping the duplication confines this entire feature to new files plus
  `practiceModeActive`-scoped branches in `GameScene.ts`, so it cannot regress
  a real run — worth the duplication.
- **`endlessHudCycleShown = -1` is load-bearing** on every state change (the
  endless-cycle jump and the mutator pin both set it) — `syncEndlessHudLabel`
  early-returns when the shown cycle already matches, so without the reset the
  HUD label would never repaint.
- **Neither new method touches storage or the best-cycle record.**
  `applyPracticeArena` never calls `saveEndlessBestCycleIfHigher` or
  `recordEndlessCycleReached`, and the real cycle-advance path in
  `checkEndlessModeSpawns` is now itself gated on `!this.practiceModeActive`
  for the same write — a sandbox must not claim a best cycle.

**Tests:** none added, deliberately. The only new pure logic is
`endlessCycleRampFactor`, whose entire content is `Math.pow(n, cycles)` —
asserting that equals repeated multiplication tests JavaScript, not this
feature. Everything else is Phaser/ECS scene wiring, which this repo's
testing boundary does not exercise live. The 1256-test suite stayed green
throughout; verification is the human playtest filed as
**POLISH-PRACTICE-TIME** under `## Human gates`.

**Files:** `src/data/PracticeArena.ts` (new), `src/ui/PracticeDock.ts` (8th
row + `onArenaChange`/`onMutatorChange`), `src/game/scenes/GameScene.ts`
(`applyPracticeArena`, `setPracticeMutator`, dock wiring, 3 practice guards).

---

## BUG-VITALITY-HEAL-DEAD — mid-run heal grants land on the player · DONE 9b520d0

**Value:** the shipped, publicly deployed game lied to the player at a decision
point. Vitality's card promises max HP **and** a heal, and picking it at
12/120 HP granted the headroom but **zero** healing, every single run. Traced
the whole chain in code: (1) `Upgrades.ts:390` — vitality's `apply` does
`stats.currentHealth += 20` (and `+= LEVEL_10_BONUSES.vitality` at mastery),
so the intent is explicit in the source; (2) `stats` here is
`this.playerStats`, whose `currentHealth` is only a **mirror** of the ECS
`Health.current` component; (3) `syncStatsToPlayer` (`GameScene.ts:8658`) is
the only thing that pushes `playerStats` into the ECS, and its health block
only ever clamps `Health.current` **downward** — it reads
`playerStats.maxHealth` and never `playerStats.currentHealth`, so the heal had
nowhere to go; (4) the mirror is then overwritten from the ECS on the next
damage event (`GameScene.ts:4485`), erasing the orphaned `+20` without it ever
being observed. Vitality is one of the four priority stats the upgrade scorer
pushes hardest (`GameScene.ts:8081`). The practice-build path had already hit
this and worked around it locally, documenting the exact mechanism at
`GameScene.ts:4962-4965`. Grepping every mid-run writer of `stats.currentHealth`
found four grants riding the identical dead path — not one bug but a class:
the Vitality stat upgrade, the Fortify limit-break overflow
(`+OVERFLOW_BONUS.health`), and the Vitality Core (+15) and Armor Plate (+10)
relics.

**Shipped:** `grantBuildHeal(healAmount)`, a private helper on `GameScene`
that lands a heal on `Health.current` (clamped to `Health.max`) and refreshes
the mirror, called at the four grant sites with the mirror's delta measured
across the grant — after `syncStatsToPlayer` has already widened `Health.max`.
Wired into: `applyCombinedUpgrade` (covers both Vitality and Fortify, since
limit-break overflow upgrades route through the same `upgradeType === 'stat'`
branch), the `fortune` shrine relic roll, the chest relic drop, and the
`relic_vow`/`blood_pact`/`frenzy` deal path (wrapping the whole deal covers
`relic_vow`'s two rolled relics in one delta).

**Design:**
- **A delta at the call site, not a raise inside `syncStatsToPlayer`.** The
  tempting fix — make `syncStatsToPlayer` raise `Health.current` up to
  `playerStats.currentHealth` — is a trap. The mirror is a *lagging* one,
  refreshed from the ECS only at specific damage/heal points
  (`GameScene.ts:3313, 3913, 4485, 4585, 4966`). Any ECS-side HP drop that
  skips a refresh leaves the mirror stale-high, and `syncStatsToPlayer` runs
  from many unrelated event paths (relic drops, shrines, timed-buff apply
  *and* expiry — `GameScene.ts:3335, 3349, 8540, 8565`), so a sync-level
  "raise to mirror" would silently heal the player for free at unpredictable
  moments. The delta approach only ever adds HP that a grant *just* produced,
  measured across that grant alone.
- **Deliberately upward-only.** The `healAmount <= 0` guard makes grants that
  *reduce* the mirror (Vampiric Fang, `blood_pact`) fall straight through as a
  no-op — byte-for-byte unchanged behavior. Making it bidirectional would be a
  difficulty change, not a wiring fix.
- **`src/data/{Upgrades,Relics,LimitBreakUpgrades}.ts` left untouched.** Their
  `apply` functions already express the correct intent
  (`stats.currentHealth += N`); the defect was in the wiring downstream, not
  the data. Changing them would be a balance change.
- **`blood_pact`'s HP-halving is the same dead path in the downward
  direction**, and is deliberately **not** fixed here: `GameScene.ts` sets
  `this.playerStats.currentHealth = halvedCurrent` on the same dead mirror,
  so the pact's "HP halved" cost never actually lands, making it strictly
  better than advertised. Correcting it makes the game *harder* — a balance
  call for the human, not a wiring fix — so it's filed separately as
  `BUG-BLOOD-PACT-HALVE-DEAD`.

---

## FEAT-PRACTICE-BUILD — fight a boss with the build you'd really have · DONE 41df31c

**Value:** practice v2 (FEAT-PRACTICE-BOSS) fielded a real boss at real HP but on
a **level-0-passives** chassis — `GameScene` applied `practiceWeaponLevel` +
`practiceEvolved` to the weapon only, never touching the nine stat upgrades
(`Upgrades.ts` `currentLevel` starts at 0). `BACKLOG.md` filed this verbatim as
practice mode's known limit: absolute time-to-kill reads longer than a real
10-minute fight, so *relative* questions (TITAN vs SWIFT vs none) worked but
*absolute* "siege or drag" reads across five queued playtest items —
POLISH-BOSS-AFFIXES (c), POLISH-MINIBOSS-AFFIXES (c), POLISH-AFFIX-PARAGON (c),
POLISH-BOSS-LEGION (e), POLISH-ENDLESS-MUTATORS (g) — stayed unanswerable even
with practice mode shipped.

**Shipped:** a 6th PRACTICE dock row, BUILD, next to INVINCIBLE. Steps through
four rungs — OFF / 10-MIN / DEEP / MAX — each a flat level applied to all nine
stat upgrades, moving player level/XP and ship tier to match.

**Design:**
- **A flat depth is the only build shape a real run can reach.**
  `BREAK_LEVEL_GATES = [3, 6, 9]` bars a stat from passing a gate unless every
  owned stat is already at/above it (`canLevelUpgrade`), so "all owned stats at
  the same level" is gate-legal by construction — a lopsided build is not
  reachable in a real run. This is the load-bearing insight of the design.
- **Rungs sit on the gates and map to real run moments.** 9 stat upgrades ×
  1 level-up pick each + the level-1 start ⇒ player level = `1 + 9 × depth`.
  `10-MIN` (depth 3, level 28) sits on the first break gate and is grounded in
  the game's own `level_30_run` achievement; it pairs with the existing
  600s spawn scaler so `BUILD: 10-MIN` + a scaled boss **is** the real
  10-minute fight. `DEEP` (depth 6, level 55) is an endless/gauntlet build;
  `MAX` (depth 10, level 91) masters all nine.
- **Monotonic — step up only.** `upgrade.apply()` is additive, so rebuilding
  `playerStats` downward would mean reconstructing meta bonuses, ship,
  modifiers, pacts and relics from scratch. This also mirrors a real run,
  whose build only grows; reload to reset (~1s, same as any other practice
  exit).
- **Applies stats directly, not via `applyCombinedUpgrade`** — that method also
  fires achievements, codex discovery, mastery visuals and a level-up sound per
  upgrade, which at `MAX` would mean 9 mastery visuals + 9 sounds firing at
  once. `applyPracticeBuild` does the purposeful subset: `apply` → set
  `currentLevel` → `syncStatsToPlayer()`, the same stat half
  `applyCombinedUpgrade` performs, so the resulting stats are identical to a
  real run's by construction. `currentLevel` is also set on `this.upgrades`
  itself so the level-up offer engine keeps the gates honest if the operator
  keeps levelling naturally on top of a build.
- **Moves player level + XP, not just stats.** The XP curve is
  `10 × level^1.5`; at level 1 the threshold is 10 XP against a boss's 1000+
  drop, which cascades dozens of level-up modals across the fight being
  measured. Setting level 28 for `10-MIN` yields ~1 level-up per boss kill —
  realistic.
- **Tops the player up to full HP after a build step.** `vitality` raises
  `maxHealth`, but `syncStatsToPlayer` only clamps `Health.current` downward.
  A build is a chassis configuration, not a damage event, so a visibly
  part-empty HP bar after stepping up would read as a bug.
- **`BUILD` defaults to `OFF`** — a weapon-only practice run (v1's use case)
  behaves exactly as before; zero regression. **Not part of `PracticeDockState`**
  — it applies immediately on press via a callback, like `onInvincibleChange`,
  since it isn't a spawn parameter.
- **`PracticeBuild.ts` is a Phaser-free, `Upgrades.ts`-free leaf module** — it
  takes the stat-upgrade count as a parameter rather than importing the
  registry, mirroring the `PracticeTargets.ts` precedent, so it needs no module
  mocks and cannot drift.

**Found but not fixed (filed under `BACKLOG.md` → `## Later`):**
`BUG-VITALITY-HEAL-DEAD` (vitality's "heal for the bonus" never reaches the
player — `syncStatsToPlayer` only clamps HP downward) and
`BUG-MENUBUTTON-SETVARIANT-NOOP` (`MenuButton.setVariant()` is a documented
no-op, so the dock's `magenta`/`safe` highlight calls have never done
anything). Both are real-run balance/visual changes needing their own
playtest — out of scope here.

**Tests:** one file, `src/data/PracticeBuild.test.ts` — pins the invariant the
whole design rests on: a flat-depth build is gate-legal only while every stat
upgrade shares the same `maxLevel`; if a future stat upgrade lands with a
different cap, the ladder would silently stop matching what a real run can
reach with no runtime symptom. Everything else is self-evident wiring or
Phaser-coupled and untestable without a live scene, per the repo's stated
testing boundary.

**Files:** `src/data/PracticeBuild.ts` (new), `src/data/PracticeBuild.test.ts`
(new), `src/ui/PracticeDock.ts` (6th row + `onBuildChange`),
`src/game/scenes/GameScene.ts` (`practiceBuildDepth` field + reset,
`applyPracticeBuild()`, dock wiring).

---

## FEAT-PRACTICE-BOSS — practice v2: spawn any boss/miniboss with any affix, on demand · DONE 43a76b7

**Value:** the boss playtest items each name a specific enemy × specific affix pair
— POLISH-BOSS-AFFIXES asks "TITAN at ~1.7x HP: siege or drag?" and "SWIFT ×1.3
speed: chase still fair (Bastion's retreat-and-bombard especially)?"; POLISH-BOSS-
BASTION and POLISH-BOSS-LEGION each note their boss is only reachable via a deep
GAUNTLET/endless run. `rollBossAffix()` returns NONE 65% of the time
(`BOSS_AFFIX_CHANCE = 0.35`) and the paragon second affix is a further 50%
coin-flip — a specific affixed boss was roughly a 10-minute run followed by a
1-in-20 roll, which is why none of those items had ever been answered. Practice v1
(FEAT-PRACTICE-MODE) only solved the weapon half of the playtest queue.

**Shipped:** an in-run PRACTICE dock (left edge, five stacked buttons): cycle
through the 5 bosses + 5 minibosses, pick an affix and an optional paragon second
affix outright, toggle INVINCIBLE, tap SPAWN (or press `B`) as many times as you
like without the run ending.

**Design:**
- **In-run, not in `PracticeScene`.** Setup-time pickers would mean quit → reload
  → menu → re-pick → START per iteration; `PracticeScene.ts` itself is untouched
  and still awaiting its own playtest (POLISH-PRACTICE-MODE).
- **Chosen, never rolled.** Rolling in practice would reproduce the exact 1-in-20
  problem the feature exists to remove.
- **Scales at the time you'd really meet the target**, not at `gameTime` (~0 when
  you tap SPAWN). Bosses scale at `TUNING.bosses.spawnTime` (600s); each miniboss
  at its own scheduled time from `TUNING.minibosses.schedule`. A t=0 spawn would
  make "TITAN at ~1.7x HP: siege or drag?" unanswerable — it'd be a different,
  much weaker enemy than the one being judged.
- **Boss kills are fodder in practice**, joining the existing gate
  `!this.hasWon && !this.gauntletModeActive` (now also `&& !this.practiceModeActive`)
  — otherwise the first kill calls `showVictory()` and ends the run, capping
  practice at exactly one boss per page-load.
- **The Legion keeps its affix exclusion.** `spawnBoss` already skips affixes for
  `the_legion` (its split children can't inherit an affix and the shared-pool math
  must not absorb a root-only health multiplier); the dock disables the affix
  buttons and shows `N/A` rather than routing around the guard.
- **Invincibility guards the top of `takeDamage`**, ahead of the shield-barrier
  branch, so it never silently burns shield charges.
- **`PracticeTargets.ts` is a Phaser-free leaf module** deriving target ids,
  scheduled times, and the paragon affix cycle straight from `TUNING`, so they
  cannot drift and are node-testable.

**Tests:** one file, `src/data/PracticeTargets.test.ts` — referential integrity
(every target id resolves to a real `EnemyType`) and paragon-pair exclusion
(TITAN+VAMPIRIC never offered together, the pairing the dock now enforces in place
of `rollParagonAffix`'s pool filter). The dock's rendering and feel need a browser
and are filed as **POLISH-PRACTICE-BOSS**.

**Files:** `src/data/PracticeTargets.ts` (new), `src/data/PracticeTargets.test.ts`
(new), `src/ui/PracticeDock.ts` (new), `src/game/scenes/GameScene.ts` (affix
eligibility/override, scaling clock, fodder gate, invincibility, dock + `B` key
wiring and shutdown).

---

## FEAT-PRACTICE-MODE — reach any weapon at any level without grinding a run · DONE c3d00c2

**Value:** the repo's own playtest queue is ~40 items and is not draining. Every
weapon item in it opens with the same line — "Check with a real run that picks it
up" — and then asks for a judgement about *feel at a given level* ("→1.6s min as it
levels", "→0.25s floor as it levels", "evolution multipliers in
`WeaponEvolutions.ts`"). Delivering that meant a 10-minute run, RNG-gated upgrade
offers, and a stat upgrade at level 5, per weapon. PRACTICE turns each of those
into a seconds-long check, and pays back on every weapon the fleet ships next.

**Shipped:** BootScene → **PRACTICE** → pick any of the 19 weapons, any level
(clamped to that weapon's real max), evolved or not → straight into a real run on
the default stage/ship. The session writes nothing.

**Design:**
- **Isolation at the `SecureStorage` write boundary, not per manager.** The write
  surface is 25+ methods across achievements / codex / meta / best-score /
  run-history / save, and **one miss silently corrupts the real profile**.
  `CLAUDE.md` mandates all persistence flows through `SecureStorage`, whose whole
  API is `getItem`/`setItem`/`removeItem` — so two guards isolate the session
  atomically, whichever writer fires. Reads stay live so the run boots.
- **Exiting practice reloads the page.** Writes were blocked but the managers
  still mutated *in memory* (a max-level weapon trips achievements and hidden
  unlocks); without a reload the next real run's first write would flush that
  pollution to disk. Disk clean + memory clean = airtight. All three exits
  (quit / restart / quit-to-shop) reload — `scene.restart()` especially, since it
  re-runs `init` with no data and would otherwise leave a "normal" run that
  silently never saves.
- **Weapon metadata read from `createWeapon(id)` instances**, not a hand-written
  table — real name/icon/maxLevel per weapon, cannot drift, and no guessed icon key
  for the referential-integrity sweep to catch.
- **Reuses the existing `startingWeapon` init path**; only levelling + evolving is
  new. The ship's starting-weapon override is skipped in practice, or picking
  `projectile` would silently hand you the ship's weapon instead.
- **Default stage + default ship** — practice measures the weapon, so the baseline
  stays unmodified.

**Tests:** one file, `src/storage/SecureStorage.practice.test.ts` — 4 tests pinning
the isolation invariant (writes pass normally; writes and removals dropped during
practice; reads still work). Warranted because this guard is the only thing
protecting the real profile and its failure mode is silent corruption. The rendered
scene needs a browser and is filed as **POLISH-PRACTICE-MODE**.

**Deliberately not built (filed as FEAT-PRACTICE-BOSS):** on-demand boss spawning
(`spawnBoss()` is private and entangled with arena + wave timing) and an
invincibility toggle (no existing field; would mean touching the damage pipeline).
Dying in practice is harmless — nothing persists. Also not built: stage/ship
pickers in practice, and any codex gating of the weapon list.

---

## BUG-TRAIL-GHOST — trails ghosting forever as ship-shaped chevron trains · DONE 6e8c50a

**Value:** operator-reported visual bug — "the ships have this ship-shaped train
behind them that never clears; looks like we're not clearing up the ship's
shadow." Three compounding defects in `src/visual/TrailManager.ts`:

1. **Permanent ghost residue.** The persistent RenderTexture faded by filling
   near-black at 0.12 alpha — a *multiplicative* decay. In an 8-bit texture,
   channel values 1–4/255 satisfy `round(v * 0.88) == v` and never decay
   further, so every path ever flown stayed faintly burned into the RT, which
   is displayed with ADD blend. Fix: a second, *subtractive* fade pass — a
   fullscreen rect stamped with a custom `REVERSE_SUBTRACT` blend
   (`renderer.addBlendMode([ONE, ONE], FUNC_REVERSE_SUBTRACT)`) drains ~2/255
   per 60fps-frame, driving residue to exact zero. WebGL-only; Canvas keeps
   the old fade (rare fallback, lesser evil).
2. **Chevron "ghost ships".** Each segment widened front-to-back (glow
   0.5×→1.5×, core 0.3×→1.0×), so consecutive segments met in a sawtooth of
   discrete chevrons — the "ship-shaped" repeats. Widths are now uniform per
   pass (glow 1.3×, core 0.55×): one smooth ribbon; the RT fade supplies the
   temporal taper.
3. **Recycled-id streaks.** `trackedEntities` was never told about entity
   death and bitecs recycles ids, so a new spawn could inherit a dead enemy's
   last position and bridge it with a screen-crossing streak. A jump guard
   (>150px in one frame → re-anchor, no segment) covers recycling AND
   teleports without wiring every despawn site.

Also: fade fill went `0x000008` → pure black (the RT is ADD-blended — any
non-black fill tints the whole screen), and the fade is now frame-rate
independent (`1 - pow(1-FADE_ALPHA, delta*60)`; it previously ran 2× faster
at 120Hz). `resize()`/`destroy()` handle the new kill rect. Playtest
follow-up: **POLISH-TRAIL-FIX** (Human gates).

## CHORE-CI-DEPLOY-RETRY — auto-retry the transiently-failing Pages deploy · DONE 34e5373

**Value:** history carried 8+ manual "retrigger Pages deploy" commits
(016b4bd, 649194b, 27daf09, 869f12b, e0a08fb, 59e266d, 0270907, 2e42125) —
each a human chore + history noise for a known-flaky `deploy-pages` step.

**Shipped:** `.github/workflows/deploy.yml` deploy job now attempts
`actions/deploy-pages@v4` up to 3 times (30s, then 60s backoff) using the
`continue-on-error` + `if: steps.<id>.outcome == 'failure'` pattern (GitHub
Actions has no native step retry for `uses:` steps). The final attempt has no
`continue-on-error`, so a genuinely broken deploy still fails the job loudly;
build/test failures in the build job are untouched and fail immediately. The
environment URL falls back across all three attempts' outputs.

## POLISH-FONT-CANVAS-PRELOAD — make Phaser text wait for the webfonts · DONE a9a8b95

**Value:** the repo ships five self-hosted woff2 faces, `index.html` declares all
five, and `FEAT-PWA-OFFLINE`'s service worker precaches every one of them (~50 KB)
on install — and **not one of them had ever rendered for a single player**. A canvas
draw does not trigger an `@font-face` download (that is what the CSS Font Loading
API exists for), and this game draws essentially all of its text to the Phaser
canvas: 53 `fontFamily` uses of `MENU_FONT`, 8 of its monospace variant, 49 of
`DISPLAY_FONT`. Nothing anywhere in the codebase called `document.fonts.load`. The
one DOM element forcing a fetch was the boot wordmark — and because CSS only falls
through to the next family for characters the first lacks, its
`"Rajdhani", "Atkinson Hyperlegible", Arial` stack pulled Rajdhani 700 and **never
requested Atkinson at all**. So the whole neon-tech UI skin rendered in Arial, on
every load, for everyone. The bytes were already being paid for; this delivers them.

**Shipped:** `src/visual/fontLoading.ts` — a pure, injectable preloader that
requests all five declared faces via the CSS Font Loading API. Started in
`src/main.ts` before the `initializeStorage()` await (so the two overlap and boot
costs nothing in the common case) and awaited before `new Phaser.Game(...)`.

**Design:**
- **Before `new Phaser.Game(...)`, not after.** Phaser caches each text texture on
  first draw, so a face that arrives late never reaches the pixels. Loading after
  construction would have been a no-op with extra steps.
- **All five declared faces, not a computed subset.** They are all declared and all
  precached, so the declared set costs no extra bytes and cannot miss a face some
  path requests. The alternative meant reasoning about CSS weight matching —
  Rajdhani ships 500/600/700 while the canvas only ever asks `normal`/`bold` (there
  are no numeric `fontStyle` weights anywhere in `src/`) — for zero benefit.
- **Never rejects, and times out at 3 s.** This is boot-path code: a throw or a hang
  means the game never starts. A font 404 or a stalled fetch degrades to exactly the
  old behavior (Arial), never worse. The HTML boot loader already covers this window
  by design, and its 12 s hard fallback clears the 3 s timeout comfortably.
- **`load()` per face, not `document.fonts.ready`** — resolves precisely, without
  waiting on unrelated faces.
- **The font set is injected, not reached for.** `vitest.config.ts` is
  `environment: 'node'`; a module touching `document.fonts` directly would be
  untestable here.

**Tests:** one new file, `src/visual/fontLoading.test.ts` — four tests pinning the
boot-path failure modes (every face requested; a rejected face still resolves; an
unsettled face resolves on the timeout; no font loader no-ops). Warranted because a
throw or hang here means the game never boots, and both degradation paths are
non-obvious. The rendered result needs a browser and is filed as
**POLISH-FONT-METRICS** in the playtest queue.

**Known consequence, deliberately accepted:** text metrics change the moment real
fonts apply — Atkinson is wider than Arial, Rajdhani narrower — so menus previously
tuned by eye against the fallback may need nudging. That is what POLISH-FONT-METRICS
is for; the game rendering as designed is the point.

**Deliberately not built:** a font-loading progress UI, `font-display` changes,
subsetting, a DOM-sample fallback for browsers without the Font Loading API (the
no-loader path just boots in Arial), and any change to the boot wordmark or crash
overlay.

---

## FEAT-PWA-INSTALL-PROMPT — surface "Add to Home Screen" · DONE 5687c15

**Value:** `FEAT-PWA-OFFLINE` (`4a0c864`) made the game installable and fully
offline-playable, and nothing told a single player it had. iOS never fires
`beforeinstallprompt` and buries Add to Home Screen three taps deep in the
Share sheet — so the phone-first players who most need an offline launch were
exactly the ones who would never find it. This closes the arc: the capability
existed, this delivers it.

**Shipped:** a one-time, dismissible main-menu hint for a returning
(>=3 completed runs), non-standalone player. Android/desktop get an INSTALL
button wired to the captured `beforeinstallprompt`; iOS Safari gets two drawn
Share-sheet steps. Pure policy + UA detection in `src/pwa/InstallHint.ts`
(node-tested), DOM overlay in `src/ui/InstallHintOverlay.ts`, wired in
`BootScene`. The overlay chrome shared with the profile-transfer overlays was
extracted to `src/ui/OverlayKit.ts`.

**Design:**
- **One-time, no re-nag.** Stamped on *show*, not dismiss — `BootScene.create()`
  re-runs on every orientation flip and every return to the menu, so the stamp
  is the only thing stopping it reopening each time. Same reasoning as the
  backup nudge's cooldown; unlike that one, this never fires twice.
- **The backup nudge outranks it.** Both are DOM overlays on the same menu and
  both can qualify on one `create()` (backup >=25 runs, install >=3). Losing a
  profile costs more than missing an install, and two stacked backdrops fight —
  so the install hint defers, unstamped, and takes a later launch.
- **Subscribes to `beforeinstallprompt`, never checks once.** Chrome fires it on
  its own schedule, routinely after the menu is up; a one-shot check would have
  made the whole Android/desktop half silently dead.
- **`preventDefault()` on capture** suppresses Chrome's mini-infobar so the hint
  is the only install affordance.
- **iPadOS is detected by `maxTouchPoints`, not UA** — iPadOS 13+ sends the
  desktop macOS UA byte-identical to a real Mac's.
- **iOS non-Safari (`CriOS`/`FxiOS`/`EdgiOS`/`OPiOS`) gets nothing** — those
  WebKit wrappers route Add to Home Screen differently or not at all, and wrong
  instructions are worse than none.
- **Drawn inline SVG, not emoji**, per the repo's standing anti-glyph stance
  (`POLISH-GLYPH-SWEEP-2`).

**Tests:** one new file, `src/pwa/InstallHint.test.ts` — UA detection (the
iPadOS-as-Mac and iOS-Chrome traps) and the gate. The overlay/`BootScene`/
capture paths need a DOM the node suite does not have; they are covered by
**POLISH-PWA-INSTALL-PROMPT** in the playtest queue.

**Deliberately not built:** in-app update prompt, a SETTINGS install entry, any
re-nag schedule, install analytics.

---

## FEAT-DAILY-SHARE — one-tap shareable daily/weekly result · DONE 92f3d5f

**Value:** the daily/weekly challenge ended in a purely private local
leaderboard — a player could beat a seeded run shared by the whole world and
had no way to say so. This is the game's first and only organic growth loop,
now that it is publicly linked from the parallelogramist network: a
Wordle-style COPY RESULT gives every daily run a pasteable artifact.

**Shipped:** a pure formatter, `formatDailyShareText` (`src/meta/DailyShare.ts`,
zero imports, node-testable), and a teal COPY RESULT pill wired onto **both**
end screens (`PauseMenuManager.gameOver()` and `.showVictory()`) via a shared
`createDailyShareButton()` helper. One tap copies a deterministic four-line
summary — title/date, grade/time/score(/victory), modifiers, site link — to
the clipboard via the existing `src/utils/Clipboard.ts` (no new dependency).

**Design:**
- **Plain text, no emoji, no block-glyph grid.** `BACKLOG.md` specified "plain
  text + site link" verbatim, and the repo has a standing anti-glyph stance
  (`POLISH-GLYPH-SWEEP-2`) — no 🟩⬛ grid, no `███░░░` meter.
- **Locale-pinned to `en-US`** (`toLocaleString('en-US')`), deliberately
  diverging from the end screens' bare `toLocaleString()`. Share text is a
  canonical artifact players paste side by side to compare, and a bare call
  renders `4.210` under `de-DE` — silent corruption a byte-identical
  comparison can't tolerate.
- **Hardcoded site URL constant**, not `window.location.origin` — `origin`
  would paste `http://localhost:5173` into share text cut from a dev build.
  `CNAME` pins the real value: `game.parallelogramist.com`.
- **Pointer-only**, no key binding. `SPACE`/gamepad-A already restart on the
  game-over screen and `C`/`N` already navigate the victory screen; copying to
  a clipboard is inherently a pointer/tap affordance (prior art: the crash
  overlay's pointer-only COPY ERROR LOGS).
- **`stopPropagation()` against the tap-anywhere restart.** The game-over
  screen restarts on any scene-level `pointerdown` 500ms after death; without
  cancelling the button's own down-event, tapping COPY RESULT would copy and
  instantly restart the run in the same gesture.
- **Both end screens, not just game-over.** A daily loss reaches `gameOver()`,
  but a daily win reaches `showVictory()`, whose Next World button restarts
  the scene with no daily data at all — so without wiring both, a won daily
  run, the best outcome a daily run can have, would never see a game-over
  screen or a share button.
- **`LeaderboardScene` copy buttons left out.** Stored `DailyLeaderboardEntry`
  records carry no modifier ids and no grade, so they physically cannot
  reproduce this text — a different feature needing a storage change, not a
  cut corner.

---

## FEAT-PWA-OFFLINE — installable, offline-capable PWA · DONE 4a0c864

**Value:** this is a phone-first browser game that required the network to
start — airplane mode, a subway tunnel, or a hotel wifi blip meant a blank
screen, not a degraded game. Nothing about the game actually needs a server:
the built shell is ~2.5 MB of fully static files (music 2.1 MB, icons
136 KB), so a precached shell is cheap. It also let the fine print's "no
accounts, no analytics, no third-party trackers" promise be false while
`index.html` shipped every player's IP to `fonts.googleapis.com` and
`fonts.gstatic.com` on every launch.

**Shipped:** a web manifest (`public/manifest.webmanifest`, name "Pew Pew
Survivor" / short name "Survivor", `display: standalone`) with real icons
rendered from `public/favicon.svg` via `tools/build-pwa-icons.cjs` (sharp),
so installing to a home screen shows the parallelogram mark instead of a
page screenshot. A hand-rolled service worker (`tools/sw-template.js`,
generated into `dist/sw.js` by a vite plugin) precaches the app shell and
runtime-caches music on first play. The five latin woff2 faces (60 KB total)
previously loaded from Google Fonts are now self-hosted in `public/fonts/`
with their OFL licenses, so a cold offline launch has no request that can
fail and the privacy promise is true.

**Design:**
- **No new dependency.** The repo has exactly two runtime deps (phaser,
  bitecs); `vite-plugin-pwa` would drag in the workbox tree to save ~60 lines
  still worth auditing on a SW shipping to a live public site. Every cache
  decision is readable in one file (`tools/sw-template.js`).
- **Navigation is network-first with a 3s timeout and cache fallback** — the
  entire anti-stale guarantee. An online launch always fetches the newest
  `index.html`, which names the newest hashed bundles, so no in-app update
  prompt is needed and a flaky network (the actual value case) falls back to
  cache instead of hanging.
- **The worker takes over immediately** (`skipWaiting()` + `clients.claim()`)
  with **no `controllerchange` reload** — auto-reloading there would kill a
  run in progress. This is safe because `src/` has zero dynamic imports (only
  a test file uses `await import`), so a running page never fetches a hashed
  chunk mid-run, and every URL a live page can still request (`/sfx/*.ogg`,
  `/icons/*`, `/music/*.xm`) is unhashed and present in the new precache too.
- **Music is runtime-cached, not precached**, and its cache name is
  deliberately unversioned (`music-v1`), surviving deploys — 2.1 MB of
  tracker modules a player may never hear would triple the install cost, and
  the files never change between builds.
- **The precache list is generated from the finished `dist/` tree** by a vite
  plugin in `closeBundle` (the only hook that sees both the rollup output and
  the `public/` copy), keyed by a content hash of the selected files so any
  changed byte renames the cache and forces every client to re-fetch. The
  selection rule (`src/pwa/precacheManifest.ts`) is a denylist — excluding
  `/sw.js` and `/CNAME`, and any `/music/*` prefix — so a newly added public
  asset is never silently dropped from the offline build. It is the one
  function in this feature with a test, because both exclusions fail
  silently and severely: precaching `/sw.js` would permanently pin every
  client to a dead worker with no recovery path.
- **Kill switch:** `PWA_KILL=1 npm run build` emits a self-destruct worker
  (`tools/sw-kill-template.js`) instead of the real one — it drops every
  cache and unregisters itself, reaching clients within 24h (the only way to
  truly remove a service worker is to deploy a newer one that unregisters
  itself).

Install + airplane-mode behavior needs a human with a phone; filed as
**POLISH-PWA-OFFLINE** on the playtest queue. Two pre-existing gaps were
filed as follow-ups rather than fixed here: **POLISH-FONT-CANVAS-PRELOAD**
(Phaser draws almost all text to canvas, which triggers no font download, so
a cold load may silently render menus in Arial) and
**FEAT-PWA-INSTALL-PROMPT** (nothing currently tells a player the game is
installable).

---

## FEAT-SAVE-EXPORT-REMINDER — nudge long-lived profiles to back up · DONE da469b7

**Value:** `FEAT-SAVE-EXPORT` (`a876ed0`) shipped a complete export/import
system, but a passive one: it only ever saves a player who found SETTINGS →
DATA → EXPORT *before* their storage was evicted. The profile most likely to
be destroyed — hundreds of runs, never exported — belongs to exactly the
player who never opened that menu. This is a phone-first browser game and iOS
Safari's ITP evicts script-writable storage after ~7 days without site
interaction, so the export had a recovery path and no discovery path.

**Shipped:** a stored last-backup timestamp, a dismissible BACK UP YOUR
PROGRESS prompt on the main menu for an invested profile with no fresh backup
(BACK UP NOW swaps the same overlay straight into the export panel — one tap
from warning to blob), and a live backup status line in SETTINGS → DATA
("Never backed up — progress lives only on this device." / "Backed up N days
ago.") replacing the old static hint.

**Policy:** nudge at >= 25 completed runs (`newcomerMultiplierForRuns` treats
<10 as a newcomer, so 25 is well past the tourist band), when there is no
backup newer than 30 days, at most once every 7 days — the cooldown is
deliberately the ITP eviction window, since a warning that fires more often
than the loss it warns about is noise.

**Design notes:**
- The export marker is written on **COPY/DOWNLOAD**, not on opening the
  overlay: opening the export screen and closing it is not a backup, so
  `showProfileExportOverlay` gained an `onExported` callback that a failed
  clipboard write deliberately does not fire.
- Both markers are **non-transferable**. They describe this device's
  relationship to its backups, not the profile; carrying the exporter's
  markers over would tell the importing device it was backed up at a time it
  never was. `applyProfilePayload` instead restamps the export marker from
  `payload.exportedAt` after the removes loop — the blob you just imported IS
  this profile's most recent backup, dated when it was made, so importing a
  months-old blob correctly still reads as stale and re-nudges.
- The nudge timestamp is stamped **on show**, not on dismiss: BootScene's
  `create()` re-runs on every orientation flip (`installOrientationWatcher`
  restarts menu scenes) and on every return to the menu, so the cooldown is
  the only thing stopping the prompt reopening each time.
- The prompt is a **DOM overlay**, reusing `ProfileTransferOverlay`'s existing
  builders — BootScene's dense scaled portrait/landscape layout is untouched.
  It is torn down in `shutdown()` because a DOM node outside Phaser's
  lifecycle otherwise survives the orientation-flip restart.

**Files:** `src/storage/BackupReminder.ts` (new — the 2 markers + the pure
policy), `src/storage/BackupReminder.test.ts` (new — policy + copy
boundaries), `src/storage/StorageBootstrap.ts` (2 keys registered),
`src/storage/ProfileTransfer.ts` (both keys non-transferable),
`src/storage/ProfileArchive.ts` (import restamps the marker),
`src/storage/index.ts`, `src/ui/ProfileTransferOverlay.ts`
(`renderExportPanel` extracted and shared, `onExported`,
`showBackupReminderOverlay`), `src/game/scenes/SettingsScene.ts` (live status
line + `onExported`), `src/game/scenes/BootScene.ts` (the nudge),
`src/storage/ProfileTransfer.test.ts` (the transferable-set assertion, now
naming all three device-local keys).

**Deliberately out of scope:** cloud sync, accounts, auto-backup, QR codes, a
post-run nudge surface, any blob-format change.

**Playtest follow-up:** filed as **POLISH-SAVE-EXPORT-REMINDER** in
`BACKLOG.md` → `## Human gates`.

---

## FEAT-ACHIEVE-ENDGAME — achievement coverage for the endgame that exists · DONE 5e2770d

**Value:** the July content wave — gauntlet mode, endless cycles/mutators,
Paragon elites, bosses #4 The Bastion and #5 The Legion — awarded **zero** of
the 31 persistent achievements, so the reward layer went silent exactly where
the current endgame lives: grinding to gauntlet wave 14, surviving to endless
cycle 9, or killing a double-affix Paragon boss said nothing.

**Shipped:** 13 achievements over records that already persist — GAUNTLET
best-wave tiers (5/10/15), post-victory ENDLESS deepest-cycle tiers (1/5/10),
Paragon kills (first/25), and a first-kill per boss — on the existing gold
scale, surfaced in AchievementScene's existing four tabs. Plus
`syncEndgameAchievements()`, a retro-credit pass that replays the stored
records (`GauntletBestWave`, `EndlessBestCycle`, the codex's per-enemy
`timesKilled`) into achievement progress on an ACHIEVEMENTS visit, so a
profile that already cleared this content is credited in one visit instead of
having to re-beat its own records. Paragon kills have no external record and
so are the one stat that cannot be retro-credited.

**Design notes:** one tracking type per boss — `updateAchievementProgress`
fans a value to *every* achievement sharing a tracking type, so a shared
`boss_first_kill` would unlock all five at once on the first boss death.
Pushes stay monotonic by recording only inside the `save*IfHigher` branch,
where the value is by construction the new best (`updateAchievementProgress`
assigns, it does not max). No new `LifetimeStats` field and no new storage
key: each stat already has a persisted owner, and
`AchievementProgress.currentValue` is itself persisted and sanitized — the
same shape `cards_discovered` and `ships_fully_modded` already use.

**Files:** `src/achievements/AchievementTypes.ts` (8 tracking types),
`src/achievements/AchievementDefinitions.ts` (`BOSS_KILL_TRACKING` map + 13
definitions), `src/achievements/AchievementManager.ts` (4 recorders),
`src/achievements/endgameSync.ts` (new — the retro-credit pass, deliberately
not re-exported from `index.ts` to keep the codex out of Node-test import
graphs), `src/game/scenes/GameScene.ts` (4 hook sites + a
`setAchievementUnlockCallback(null)` teardown detach that was previously
missing, matching CardsScene/ShopScene), `src/game/scenes/AchievementScene.ts`
(detach → sync → claim pass, in that load-bearing order),
`src/data/referentialIntegrity.test.ts` (boss-kill keys resolve to real enemy
types with exactly one achievement each; achievement ids unique + every
`nextTierId` resolves).

**Playtest follow-up:** filed as **POLISH-ACHIEVE-ENDGAME** in `BACKLOG.md` →
`## Human gates`.

---

## FEAT-ENDLESS-BEST-CYCLE — persistent deepest-endless-cycle chase metric · DONE 809f7cf

**Value:** endless mode already escalates hard — per-cycle mutators,
tightening boss intervals, ×1.25 health / ×1.15 damage per cycle, double-boss
waves from cycle 3 — but recorded none of it: a cycle-8 endless run and a
cycle-2 endless run produced byte-identical end screens, so there was no
persistent reason to push one cycle deeper.

**Shipped:** mirrors the proven GAUNTLET best-wave plumbing exactly. A
SecureStorage best-cycle is written on each cycle entry (reaching cycle N
counts, not just clearing it), a `newBestThisRun` flag is carried in the
in-run save so the "NEW BEST!" callout survives a mid-run refresh, and the
end-screen score slot shows `ENDLESS · CYCLE N — NEW BEST!` (gold) or
`ENDLESS · CYCLE N · Best M · Score S` (grey) for any post-victory endless
death at cycle 1+. A CONTINUE that dies before the first boss wave (cycle 0)
still shows the plain score line. Unlike gauntlet — which skips scoring
entirely — endless runs are scored, so the score rides along on the same line
rather than being displaced by it.

**Files:** `src/game/endless/endlessCycles.ts` (pure parse/serialize, unit
tested), `src/game/endless/EndlessBestCycle.ts` (SecureStorage wrapper),
`src/storage/StorageBootstrap.ts` (`'survivor-endless-best'` registered in
`ALL_STORAGE_KEYS` — also makes it travel via `ProfileTransfer.ts`'s derived
transferable set with no edit needed there), `src/save/GameStateManager.ts`
(`newBestThisRun?: boolean` on `SerializedEndlessState`, no `SAVE_VERSION`
bump), `src/game/scenes/GameScene.ts` (field + reset in both zeroing sites +
save-on-cycle-entry + save/restore of the flag + end-screen data),
`src/game/managers/PauseMenuManager.ts` (`GameOverData.endless` + the
end-screen line).

**Sets up:** endless deepest-cycle achievement tiers, readable via
`loadEndlessBestCycle()` — see **FEAT-ACHIEVE-ENDGAME** in `BACKLOG.md` →
`## Next`. Playtest follow-up filed as **POLISH-ENDLESS-BEST-CYCLE** in
`BACKLOG.md` → Human gates.

## FEAT-SAVE-EXPORT — profile backup: export/import meta-progression · DONE a876ed0

**Value:** every byte of progress (gold, shop, ascension, cards, hidden
unlocks, codex, achievements, best scores, run history — all keys in
`StorageBootstrap.ALL_STORAGE_KEYS`) lived in ONE browser's localStorage.
Safari evicts script-writable storage after ~7 days of disuse (ITP), "clear
site data" or a lost phone wipes hundreds of runs with no recovery path, and
there was no way to move progress between phone and desktop — the single
biggest real-player reliability gap left in the game.

**Shipped:** a PROFILE row in SettingsScene → DATA offers **EXPORT** (one
portable, versioned, checksummed, AES-GCM-encrypted blob — file download +
copy-to-clipboard fallback for iOS) and **IMPORT** (paste/file pick →
validate version + checksum + shape → explicit overwrite confirm → atomic
all-or-nothing restore + reload; corrupt/foreign/partial blobs rejected with
a clear message and ZERO partial writes).

**Design notes:**
- The at-rest key derives from a per-installation random salt, so a blob
  encrypted with the device key would be undecryptable on any other device —
  the export generates its own random salt per export and embeds it in the
  envelope (`PEWSAVE1:<saltB64>:<ivB64>:<ciphertextB64>`); any install derives
  the same key from the shared base material + that salt.
- Import is a full replacement over the transferable key set, not a merge — a
  key absent from the blob is cleared, so the old profile's achievements can't
  survive underneath the imported one.
- The in-run save (`survivor-game-state`) is deliberately non-transferable and
  always cleared on import — resuming a run on top of a different device's
  meta-progression is a mismatch, not a feature.
- Unknown keys in an imported blob are ignored, never rejected — a phone on a
  cached older build must still be able to import a blob from an updated
  desktop.
- Restore takes effect via a full page reload (`window.location.reload()`,
  mirroring the existing `resetAllStorageAndReload` path), since every manager
  singleton reads its state in its constructor.

**Files:** `src/storage/ProfileTransfer.ts` (pure pack/validate/unpack core,
unit-tested), `src/storage/ProfileArchive.ts` (portable AES-GCM codec +
SecureStorage IO), `src/ui/ProfileTransferOverlay.ts` (DOM export/import
overlays — Phaser has no text input or file picker), `src/utils/Clipboard.ts`
(extracted from `main.ts`, now a 2nd consumer), `src/game/scenes/SettingsScene.ts`
(DATA card EXPORT | IMPORT row).

**Deliberately out of scope:** cloud sync, accounts, QR codes, auto-backup,
blob v2 migration, exporting the in-run save. Real-device round-trip verify
filed as **POLISH-SAVE-EXPORT** in `BACKLOG.md` → Human gates (agents can't
browser-test). A nudge-to-back-up follow-up proposed as
**FEAT-SAVE-EXPORT-REMINDER** in `BACKLOG.md` → Next.

## Resolved Open items (closed at the 2026-06-09 groom)

- **CHORE-1 — Remove 5 empty directories · DONE 2026-06-09.** `src/types`,
  `src/ui/components`, `src/data/enemies`, `src/data/upgrades`, `src/data/weapons`
  rmdir'd in the main checkout (untracked by git, nothing to commit).
- **CHORE-2 — Resolve the branch chain · DONE (verified 2026-06-09).** `3db4e75`
  (worktree-wire-dead-stats) and `a76fcf4` (worktree-top10-features) are both
  ancestors of `master`; the worktree branches no longer exist. Nothing left to merge.
- **CHORE-3 — Foreign files swept into the top-10 branch · DONE (verified 2026-06-09).**
  The accessibility files swept in by `a76fcf4` were kept and have since been wired:
  `ColorblindPipeline` is registered in `main.ts`/`GameScene`, `SettingsManager`
  persists `colorblindMode`. Remaining gap (no Settings UI) filed as FEAT-COLORBLIND-UI.
- **CHORE-4 — Local `.claude/settings.json` disables bg worktree-isolation.** Purely
  informational; folded into the env note at the top of `BACKLOG.md`.

## Closed proposal veins (full notes)

### PROPOSE-PURE-DATA-TESTS — regression-lock the untested pure data modules · DONE · area: testing
The "add missing coverage for a pure, marquee, multi-consumer module" vein (PerformanceGrade
`5940c9a`, DirectorSystem round-trip `9a70746`, WeaponEvolutions `5a00de6`,
**RunModifiers `706e823`**) covered each pure module whose `apply`/selection math silently
mutates `PlayerStats` or drives spawns, where a typo'd field, wrong sign, or unreachable id
ships as a quiet balance/dead-feature bug with nothing to catch it. **VEIN CLOSED
(2026-06-07) — every candidate is now covered; no pure, browser-free `apply`/selection data
module remains untested.** A future need here would be a *new* data module, not this vein.
- ✅ **`src/data/Pacts.ts`** — **DONE `9a17001`** (29 cases). 5 `apply` fns (pre-run curses),
  Phaser-free. Locked data integrity (unique ids, non-empty id/name/description/reward, finite
  color); `MAX_PACTS` is a positive integer AND reachable (pool ≥ MAX_PACTS, since
  PactSelectScene caps distinct picks at MAX_PACTS); `getPactById` round-trip; each `apply`'s
  exact factor/delta vs the real `createDefaultPlayerStats` baseline with a `changedKeys`
  no-stray-write guard + coverage lock; a direction lock (gold reward always rises, no reward
  regresses, curse pacts raise `curseMultiplier`, fragility pacts drop their knob — catches a
  flipped sign independent of the factor spec); a stacking lock (additive curses sum,
  multiplicative rewards compound — pacts are the one selection that stacks, up to MAX_PACTS);
  and finite/health invariants. Teeth verified by mutation.
- ✅ **`src/systems/DirectorSystem.ts`** — **DONE `c0ab86d`** (22 cases). Only the save
  round-trip was tested (`9a70746`); now the credit-accrual rate, the per-enemy spawn-cost
  formula (component weights + category multipliers + sqrt/floor + id-keyed cache), the
  per-strategy biasing, and the affordability/no-candidate/save branches of
  `pickEnemyFromDirector` are locked, plus a real-data integrity check (every `ENEMY_TYPES`
  cost a finite int ≥ 1, tiers cost-ordered). Strategy pinned + `Math.random` mocked per
  branch for determinism; teeth verified by mutation.
- ✅ **`src/data/RunModifiers.ts`** — **DONE `706e823`** (48 cases). 15 (not 17) `apply` fns,
  Phaser-free; biggest surface, highest payoff. Locked data integrity + `selectRunModifiers`
  invariants + each `apply`'s exact factor/delta vs the real `createDefaultPlayerStats`
  baseline, with a `changedKeys` no-stray-write guard and a coverage lock so a new modifier
  without a spec fails the suite.

Pattern is proven and low-risk: import the module (stub `'../weapons'` only if it transitively
pulls `Upgrades.ts`), assert data integrity + `apply`/selection behaviour against `PlayerStats`.
One module per session, test-first, ~15-25 cases each.

> **Dead-stat vein — FULLY CLOSED (2026-06-06).** A full grep of every PlayerStats field
> written by a data file (`Relics`/`Upgrades`/`LimitBreakUpgrades`/`PermanentUpgrades`/
> `Pacts`/`RunModifiers`/`ShipCharacters`) against reads in any system/weapon/collision
> path found exactly **four** write-only no-ops, now **all shipped**: `weaponSynergy`
> (`501b5bc`), `slowResistance` (`457a755`), `chainLightningCount` (`4d4386e`), and the
> last one **`luck` (`2a094e0`)** — wired to bias relic-drop rarity via the existing rarity
> system (not the upgrade modal, which has no tiers — see PROPOSE-UPGRADE-RARITY-TIERS above
> for that net-new option). Every other field — including the heuristic's low-read
> `attackSpeedMultiplier`/`gemValueMultiplier`/`iframeDuration`/`rangeMultiplier`/
> `projectileSpeedMultiplier` — was verified genuinely consumed. **No write-only PlayerStats
> field remains;** a new dead stat would only appear with a *new* upgrade/relic.

> **The corruption-hardening vein is CLOSED (2026-06-06).** Every SecureStorage
> loader in the codebase is now hardened + tested: BestScore `0b81956`,
> Combo-restore `2a283e0`, Ascension `bb7e00f`, MetaProg `1232d43`, Achievement
> `6de57f7`, Codex `38599e4`, Settings `b0377f7`, and the final one **MusicManager
> `15cdf16`** (which turned out crash-class, not the "low-impact BGM prefs" this
> note had assumed — a non-finite stored volume throws on the Web Audio gain node,
> per-frame via the intensity driver). No un-hardened persistence loader remains;
> a future tamper-resilience need would be a *new* surface, not this vein.


---

## Changelog

(most recent first; see `git log` for full detail)

- `7fcfd2e` FEAT-ENDLESS-CYCLE-MUTATORS — **named per-cycle endless mutators**.
  Was the sole Proposed (auto) item in Next; built to completion. **Value:**
  endless cycles differed only by stat ramps + affix luck; each boss-wave
  cycle now rolls one of five named cycle-wide mutators (SWIFT SWARM /
  VOLATILE AIR / GOLD RUSH / XP SURGE / IRON HORDE), never repeating the
  previous cycle, announced on the cycle banner + pinned in the HUD
  top-center slot. Pure roll/meta module `src/data/EndlessMutators.ts`
  (4 tests); spawn/roll-time effects only, trash-tier gate; optional
  `endlessState.mutator` persistence with sanitize guard, legacy saves
  restore mutator-free. Feel/balance → POLISH-ENDLESS-MUTATORS. Follow-up
  proposed: FEAT-ENDLESS-BEST-CYCLE.
- `b2b30ae` FEAT-AFFIX-PARAGON — **double-affix Paragon elites for deep
  endless/gauntlet**. Was the sole Proposed (auto) item in Next; built to
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

- `7e90628` FEAT-WEAPON-WAKE — **19th weapon "Caustic Wake", movement-driven
  trail**. Was the sole Proposed (auto) item in Next; built to completion.
  **Value:** all 18 prior weapons fire on a clock (or, Guardian, on damage
  taken); none key off the player's *movement*. The Wake is the arsenal's
  first movement-driven archetype: it lays a lingering caustic ribbon along
  the ship's path as it moves, and enemies standing in a live segment take
  ticking damage — output scales with distance travelled, rewarding
  mobility/kiting builds, the inverse of Guardian's face-tank identity.
  **Novel mechanic:** every other weapon is driven by BaseWeapon's
  cooldown→attack loop; the Wake overrides `update()` to skip that loop
  entirely. Distance-gated arc-length emission (drop a segment every 26px
  travelled, not every N seconds) lives in the pure, unit-tested
  `wakeLogic.ts` (8 tests). The class (`WakeWeapon.ts`) owns a 128-segment
  pool, a 4 Hz collision sweep gated by `cooldown` repurposed as the
  per-enemy re-hit interval, and the acid-green trail visual (fading with
  segment age). Mastery **"Undertow"**: enemies caught in the wake are
  slowed 25% for 0.6s, refreshed each pass (FrostNova's `Velocity.speed`
  set/restore idiom). Evolution **"Slipstream"** (via `swiftness` L5): wider
  (×1.3 range, ×1.2 size), harder (×1.45 dmg), faster re-hit (×0.85 cd), and
  a dedicated `EVOLVED_LIFETIME_MULT` (×1.35) since duration isn't an
  evolution stat. Synergy **"Hit and Run"** (wake+homing_missile kiting
  build, +20% dmg / 10% faster both — Homing Missiles had no synergy yet and
  was flagged cold in BALANCE-2). Full mirror-list sync: registry
  (`index.ts`), `UNLOCKABLE_WEAPONS` (`Upgrades.ts`), evolution recipe,
  synergy, `aura` mastery category (`WeaponManager.ts`), IconMap
  (`wind-slap`). All three locked content-integrity test arrays updated. tsc
  + vite build clean, 1156 tests green (1148 + 8). Feel/balance → playtest
  queue (POLISH-WEAPON-WAKE). Follow-up proposed: FEAT-BOSS-MITOSIS.

- `ec6c47a` FEAT-SHIP-MODS-2 — **ship mod follow-ups**, same-day completion of
  the FEAT-SHIP-MODS-1 follow-up list on direct operator request (ahead of
  the BALANCE-SHIP-MODS playtest — the numbers may still move, the plumbing
  won't). **Icons:** `ShipModTrack.icon` added to the contract (spec
  updated); the 12 archetypes map to existing atlas keys
  (hull→heart, thrusters→rocket, weapons→sword, targeting→target,
  salvage→coins, datalink→brain, cooldown→timer, armor→shield,
  regen→bandage, lifesteal→vampire, boss→skull, luck→clover), rendered on
  the HANGAR card between the ship kicker and effect line (gold tint at
  MAXED), test-locked against ICON_MAP. **Ship select:** WeaponSelectScene
  ship cards show `MODS n/9` (dim at 0 / accent in progress / gold `MODS
  MAXED`), positioned at y=−28 in the banner-to-description gap — the
  description block grows DOWNWARD from y=18, so even Apex's wordy blurb
  can't collide. **Achievements:** new `ships_fully_modded` tracking type +
  `ship_mods_first` "Ace Mechanic" (1 ship, +500g) → `ship_mods_fleet`
  "Fleet Admiral" (all 11, +5,000g + 5% gold stat bonus). Fed by new
  `ShipModManager.getFullyModdedShipCount()` (counts against the CURRENT
  catalog; a test locks Fleet Admiral's targetValue to
  SHIP_CHARACTERS.length so a roster addition can't make it unlock early).
  ShopScene records after each successful HANGAR purchase and wires its own
  unlock-delivery callback (gold/stat via MetaProgressionManager +
  achievement toast + gold readout refresh), detached in shutdown — per the
  menu-context reward-banking rule from FEAT-CARDS-2 (no-callback unlocks
  bank as unclaimed for AchievementScene's retro-claim).

- `261d9dc` FEAT-SHIP-MODS-1 — **per-ship mod tracks + HANGAR shop tab**, the
  last unbuilt piece of the Sky Force Reloaded meta loop (cards + scanner
  shipped as FEAT-CARDS-1/2 the same day). Previously parked as "BLOCKED on
  human economy sign-off"; the operator requested the work directly, so a
  conservative first-pass economy shipped with tuning explicitly owned by
  BALANCE-SHIP-MODS in the playtest queue. **Design:** spec at
  `docs/superpowers/specs/2026-07-03-ship-mod-tracks-design.md` (durable
  source of truth — frozen API contract, archetype table, per-ship
  assignments, economy). Each of the 11 ships gets 3 short tracks (3 levels,
  400/700/1200 gold; 6,900/ship, ~76k full fleet) picked from 12 shared
  archetypes to REINFORCE that ship's identity (Interceptor:
  thrusters/cooldown/targeting; Juggernaut: hull/armor/regen; Boss Hunter:
  boss/salvage/lifesteal; …). Magnitudes deliberately flavor-sized (a maxed
  track ≈ one mid shop tier; a test literally guards the band). **Data**
  (`src/data/ShipMods.ts` + tests): catalog + `getShipModTracks` /
  `getShipModCost` (Infinity at/past cap, corrupt level input fails safe) /
  `aggregateShipModBonuses` (identity defaults; *Mult fields compound
  value^level, adds linear; non-finite levels rejected as corruption).
  Shared archetype object references guarantee same-id-same-effect (locked
  by test). **Persistence** (`src/meta/ShipModManager.ts` + tests):
  singleton, `survivor-meta-ship-mods` → `{ [shipId]: { [trackId]: level } }`
  via SecureStorage, loader rebuilds from the catalog only (junk
  ships/tracks dropped, levels integer-clamped [0,3]), key registered in
  `StorageBootstrap.ALL_STORAGE_KEYS`; `purchase()` spends NOTHING itself —
  the caller spends gold via MetaProgressionManager first (scanner
  pattern). **UI:** ShopScene HANGAR tab after the 7 upgrade categories —
  one 220×220 card per unlocked-ship×track (ship kicker, per-level effect,
  ◆◆◇ pips + LV n/3, cost button / MAXED gold state, affordable star +
  tab badge), ONE trailing teaser card when ships are locked (availability
  = the WeaponSelectScene rule via `isUnlockRequirementMet`), purchases
  mirror the shop flow exactly (deficit toast, purchase sound, gold tween,
  defensive refund if the guarded purchase() somehow returns false). Tab
  strip: 8 tabs at 720 wide = 82px/tab → compact labels
  (ATK/DEF/SPD/GOLD/UTIL/ELEM/MSTRY/HANGAR) engage below 85px; 1280 keeps
  full labels (1272 ≤ 1280). Keyboard/gamepad nav extended through the
  existing MenuNavigator wiring (8-column tab row, grid rows from the
  active card count) — no fork. **Run start:** GameScene applies aggregated
  mod bonuses immediately AFTER the ship's own bonuses (maxHealth ×= +
  round + currentHealth resync, move/damage/cooldown/gold/xp ×=,
  crit/armor/regen/lifesteal/luck +=, bossDamageMultiplier +=). Built by
  two parallel file-disjoint agents against the frozen spec contract
  (data+manager / ShopScene) with GameScene wired inline; filtered
  typecheck clean. Follow-ups → FEAT-SHIP-MODS-2 (ship-select mod display,
  icon pass, achievements).

- `c433efc` FEAT-PORTRAIT — **portrait mode support**. The game previously
  hard-blocked portrait phones with an HTML "rotate your device" overlay; it
  now plays in both orientations. **Core mechanism** (`src/utils/Orientation.ts`
  + `main.ts`): the Phaser base size is orientation-aware — 1280×720 landscape,
  720×1280 portrait — so under Scale.EXPAND the SHORTER side stays 720 game
  units in both orientations and world/UI objects hold a steady physical size
  (a landscape-only base pinned 1280 units across a ~390pt portrait phone,
  rendering everything ~3× too small). A debounced watcher (250ms, compares
  orientation CLASS not raw size, so iOS toolbar/keyboard resize bursts don't
  churn) swaps the base via `scale.setGameSize` on flips and re-lays-out live
  scenes: menu scenes `restart(sys.settings.data)` (stateless creates, original
  launch payload preserved); GameScene runs the UI-scale save-restore round
  trip (`handleOrientationFlip` → saveGameState + restart{restore,resumePaused}
  → resumes into the pause menu — rotating mid-combat deliberately pauses);
  end screens skip (run-over states — victory already CLEARED the save, a
  restore would resurrect a finished run); a flip during the level-up modal
  defers (flag settled by the selection-complete handler after the LAST queued
  modal, since a restart underneath would orphan the modal and regress
  rerolls/locks). **Audits first** (3 read-only agents): every menu scene's
  layout math at 720×1280, in-run HUD/pause/game-over/victory overlap math,
  and the simulation layer — spawns (4-edge, live scale), AI bounds,
  clamps, camera all confirmed orientation-agnostic; no gameplay change
  needed. **Reflows at width 720** (landscape 1280 arithmetic verified
  unchanged in every file): ShopScene width-aware grid columns (2 portrait);
  CreditsScene cards stack; AchievementScene single-column grid;
  WeaponSelectScene fit-capped columns in computeGridLayout (stages 2 /
  ships 3 / weapons 4 portrait) + weapon-step navigator columns now derive
  from the real grid; PactSelectScene row wrap (3+2) + navigator match;
  LeaderboardScene bests strip wraps to rows (tabs/list shift down) and
  history rows clamp to viewport width with proportional column anchors;
  MusicSettingsScene list height derives from viewport (landscape resolves
  to the legacy 380 exactly); CardsScene gets a dedicated 720×1280 design
  space (4-col grid, compact full-width scanner bar, bottom back button);
  UpgradeScene wraps 4 cards 2×2 below 800 width (0.49× shrink was
  unreadable); pause BUILD STATS + RUN MODIFIERS pair below the buttons;
  game-over WEAPON DAMAGE + PERSONAL BESTS pair below the stat column
  (144px overlaps each side otherwise); recent-runs strip hidden in
  portrait (no clear home — follow-up). **Drive-by fix:** HUDManager's
  live-resize moved the bottom-center combo readout to the right screen
  edge (half-clipped) on ANY resize — re-anchored to bottom-center.
  Everything blind-implemented (no runtime in the sandbox) — on-device
  checklist (incl. verifying setGameSize-under-EXPAND on iOS Safari and
  worst-case pause-panel height at exactly 720×1280) filed as
  POLISH-PORTRAIT.

- `08a196c` FEAT-CARDS-2 — **card-collection follow-ups**, closing every
  non-playtest item from the follow-up list the same day FEAT-CARDS-1
  (`caaba4e`) shipped. **Deferred discovery (reveal-deflation fix):**
  `rollCacheDiscovery()` now only queues — the card stays out of the archive
  grid, its bonus inactive, and it's excluded from Scanner/cache rolls via a
  private effective-discovered pool (discovered ∪ pending) — and
  `consumePendingReveal()` became the discovery moment; new
  `peekPendingReveal()` (side-effect-free) replaced GameScene's
  consume+requeue guard sync. Spec contract section updated to match. Locked
  by tests: pending stays hidden, consume discovers+persists, a pending card
  can't dupe via scan, and the scan-refund guard holds when the pending card
  is the last undiscovered one. **Aggregate bonus summary (spec ask):**
  CardsScene's idle detail line renders `ARCHIVE BONUS · +7% DMG · …` via
  pure `formatCardBonusSummary()` in Cards.ts (compounded mults as rounded
  percentage points; empty collection → call-to-action line; 4 tests).
  **Collection milestones:** new `cards_discovered` tracking type + four
  tiered achievements (`cards_discovered_1/6/12/24` → 100/300/750/2,500 gold,
  Full Archive adds +5% gold stat bonus). Fed by
  `AchievementManager.recordCardsDiscovered(totalCount)` from all three
  discovery landing sites: GameScene's end-screen reveal consumption (new
  `consumeCardRevealForEndScreen()` helper), CardsScene decrypts, and a
  CardsScene entry sync that retro-credits collections that predate the
  milestones. **Menu-context reward safety (latent-bug fix):**
  `unlockAchievement` used to set `rewardClaimed = true` unconditionally
  while delivery only happened through the unlock callback — an unlock fired
  with no callback wired (any menu context) silently ate the gold. Now it
  auto-claims only when a callback exists; otherwise the reward banks as
  unclaimed for AchievementScene's existing retro-claim pass.
  `setAchievementUnlockCallback` accepts null so scenes can detach;
  CardsScene wires its own delivery (gold/stat via MetaProgressionManager +
  transient gold banner + chime, reduced-motion aware) in create() and
  detaches in shutdown(). 4 new manager tests (tier crossing from absolute
  counts, reload persistence, banking without callback, auto-claim + detach
  with one). **Reveal sfx:** Scanner tile flip plays the weapon-evolution
  flourish (distinct from the achievement chime so a milestone crossing the
  same decrypt doesn't double a sound); end-screen reveals play the
  achievement chime timed to the glow pulse (after the victory
  fanfare/game-over sting, not colliding with them). **Icon pass:** verified
  complete — all 24 card icon keys resolve through ICON_MAP with no fallback,
  already locked by a Cards test. Remaining knob (drop rates / SCAN_COST /
  pity / milestone gold) is a human balance call → POLISH-CARDS playtest
  entry updated with the new checks (deferred-reveal semantics, banner,
  chime timing, retro-credit).

- `caaba4e` FEAT-CARDS-1 — **card collection + scanner lottery meta-progression**,
  the Sky Force Reloaded-inspired meta loop from the 2026-07-03 session. Durable
  design source of truth: `docs/superpowers/specs/2026-07-03-card-collection-meta-design.md`
  (read it before touching cards — it carries the frozen public API contract).
  **Data:** `src/data/Cards.ts` — 24 cards (10 common / 8 rare / 4 epic / 2
  legendary, rarity weights 60/30/9/1), small permanent passives (spec magnitude
  bands: cards are seasoning, the shop is the meal), `rollCardRarity` /
  `pickUndiscoveredCard` (nearest-rarity fallback, null only on complete archive) /
  `aggregateCardBonuses` (identity defaults). **Persistence:**
  `src/meta/CardCollectionManager.ts` singleton — `survivor-meta-cards` via
  SecureStorage (registered in `StorageBootstrap.ALL_STORAGE_KEYS`,
  corruption-hardened rebuild from known ids), pending-reveal queue, scanner
  `scan()` with epic-or-better **pity every 8th** sub-epic roll (SCAN_COST=500,
  gold spent by the caller via MetaProgressionManager). ~55 unit tests across
  both modules. **In-run:** GameScene applies aggregated bonuses at run start
  alongside the shop tracks (damage/attack-speed/gold/xp/magnet/move-speed mults,
  maxHealth/crit/armor/luck/reroll/banish adds, startAtLevel); data caches roll in
  `handleEnemyDeath` (boss 100% / miniboss 20% / elite 2%, once per run — the
  guard syncs with the persisted pending reveal AND is saved in the run save,
  because showVictory() consumes the reveal while a post-victory endless run
  continues; a reload there must not re-arm the drop). `ultChargeRateMult` got a
  real application point: new `setUltimateChargeRateMultiplier` hook in
  UltimateSystem (reset- and save-restore-aware, 4 tests) so Surge Array (+10%
  ult charge rate) isn't a dead epic. **Reveal:** end-screen "NEW CARD
  DISCOVERED" panel on BOTH death and victory overlays (PauseMenuManager),
  stagger-integrated, rarity glow pulse timed to the panel's LAST staggered
  element. **Archive:** new CardsScene — 6×4 grid ('?' slots with 40%-blended
  rarity hairlines, discovered mini-MenuCards), scanner panel (gold readout,
  pity countdown, DECRYPT, defensive refund if the archive completes mid-roll,
  ARCHIVE COMPLETE end state), reveal flip + glow with reduced-motion fallback,
  full MenuNavigator nav, shutdown-clean tweens, layout centered per-axis in the
  live EXPAND viewport (sibling-scene pattern). Fifth CARDS deck entry in
  BootScene; registered in main.ts. Built by a 4-implementer + 2-verifier agent
  workflow; all 5 verifier code findings fixed pre-commit (inert ultChargeRateMult,
  hardcoded 1280×720 CardsScene layout, glow-pulse timing, endless-reload cache
  guard, orphaned JSDoc). Known deviations + the reveal-deflation design nuance
  → FEAT-CARDS-2; feel/balance checklist → playtest queue (POLISH-CARDS).

- `9a17001` PROPOSE-PURE-DATA-TESTS (Pacts) — **regression-lock `Pacts.ts`**, the **final**
  candidate in the "add coverage for a pure, marquee, multi-consumer module" vein (after
  DirectorSystem `c0ab86d` / RunModifiers `706e823` / WeaponEvolutions `5a00de6` /
  PerformanceGrade `5940c9a`) — **vein now CLOSED**. The 5 pre-run pacts (player-chosen
  curses) each `apply` a curse + reward to `PlayerStats` at run start and had **no test file**,
  so a typo'd field, flipped sign, or wrong factor would ship as a quiet balance bug — a curse
  that helps the player or a reward that shrinks, with nothing to catch it. New `Pacts.test.ts`
  (29 cases): **data integrity** (unique ids, non-empty id/name/description(downside)/
  reward(upside), finite numeric color, `apply` is a fn); **`MAX_PACTS`** is a positive integer
  AND reachable (pool ≥ MAX_PACTS distinct pacts — PactSelectScene caps distinct picks at
  MAX_PACTS, so a smaller pool would make the cap unreachable); **`getPactById`** by-reference
  round-trip + undefined on unknown/empty; **per-pact `apply` lock** (table-driven) — every
  documented field hits its exact factor/delta computed from the real `createDefaultPlayerStats`
  baseline, with a `changedKeys` guard failing on any undocumented write and a coverage lock
  failing if a pact lacks a spec, plus `apply` returns undefined (mutates in place);
  **direction lock** — gold reward always rises, no reward (gold/xp) ever regresses, curse pacts
  raise `curseMultiplier`, fragility pacts drop their documented knob (catches a flipped sign
  independent of the factor spec); **stacking lock** — pacts are the one selection that
  explicitly stacks (up to `MAX_PACTS`, unlike RunModifiers' one-per-category): additive curses
  sum, multiplicative rewards compound, and a full MAX_PACTS stack stays finite + health-valid;
  **invariants** — no pact yields a non-finite stat or leaves `currentHealth > maxHealth` /
  `maxHealth <= 0`. Stubs the `'../weapons'` boundary (documented vitest pattern) so the real
  `Upgrades.ts` baseline loads in Node. Teeth verified by mutation (curse sign flip, iframe
  factor flip, stray `armor` write → 6 failures) then reverted. Pure test addition, no
  production change. Full suite **473 green** (+29), `tsc --noEmit` exit 0. Self-discovered.
  **PROPOSE-PURE-DATA-TESTS is now fully closed — no untested pure data module remains.**
- `c0ab86d` PROPOSE-PURE-DATA-TESTS (DirectorSystem) — **regression-lock the credit/cost/
  selection math of `DirectorSystem.ts`**, the credit-budget spawn director that paces every
  run (same "add coverage for a pure, marquee, multi-consumer module" vein as RunModifiers
  `706e823` / WeaponEvolutions `5a00de6` / PerformanceGrade `5940c9a`). Only its save
  round-trip was covered (`9a70746`); the accrual rate, the spawn-cost formula, the
  per-strategy biasing, and the branch logic that actually decides what spawns were all
  untested — a typo'd coefficient or sign would ship as a silent, invisible balance bug. New
  `DirectorSystem.test.ts` (22 cases): **`getEnemyCost`** — exact component weights
  (health, 1.5× damage, sqrt(xp)), category multipliers (Elite ×2 / Miniboss ×8 / Boss ×30),
  the sqrt/`Math.max(1,…)` floor, finite-integer post-condition, and the id-keyed cost cache
  + its clear on reset; **credit accrual** via `updateDirector`/`getDirectorState` — exact
  `rate(gameTime,worldLevel) × delta`, +15%/level world scaling (and <1× below level 1),
  time-rising rate, the backward-time / no-negative-credits clamp, disabled-director no-op;
  **strategy selection** — forced set/return, the RNG→4-strategy mapping, reset re-roll;
  **`pickEnemyFromDirector`** — disabled fallback delegation, save→null, exact-cost
  deduction, unaffordable→cheapest balance-floor, no-candidate→basic (no deduction); plus
  direct state get/restore/reset round-trips and a real-data integrity lock (every
  `ENEMY_TYPES` cost a finite int ≥ 1; tiers stay cost-ordered). Strategy pinned and
  `Math.random` mocked per branch so the suite is deterministic against the real RNG. Teeth
  verified by mutation (damage coefficient, Elite multiplier, credit timeScale) → 5 failures,
  then reverted. Pure test addition, no production change. Full suite **444 green** (+22),
  `tsc --noEmit` exit 0. Self-discovered. **PROPOSE-PURE-DATA-TESTS now has one candidate
  left (`Pacts.ts`).**
- `706e823` PROPOSE-PURE-DATA-TESTS (RunModifiers) — **regression-lock the untested
  `RunModifiers.ts`**, the biggest-surface candidate in the "add coverage for a pure,
  marquee, multi-consumer module" vein (after PerformanceGrade `5940c9a`, DirectorSystem
  round-trip `9a70746`, WeaponEvolutions `5a00de6`). The module's 15 per-run modifiers each
  mutate `PlayerStats` at run start via `apply`, plus `selectRunModifiers` / `getModifierById`
  — all uncovered, so a typo'd field, wrong sign, or wrong factor shipped as a silent balance
  bug. New `RunModifiers.test.ts` (48 cases): **data integrity** (unique ids, non-empty
  id/name/description, valid category, `apply` is a fn, all four categories present);
  **`getModifierById`** exact by-reference round-trip + undefined on unknown/empty id;
  **`selectRunModifiers`** invariants that are total over any shuffle (so non-flaky against the
  real `Math.random`): two distinct-category picks by default, count 0/1/negative bounds, caps
  at one-per-category when count exceeds variety, source pool unmutated; **per-modifier `apply`
  lock** (table-driven, one case each) — every documented field hits its exact factor/delta
  computed from the real `createDefaultPlayerStats` baseline, with a `changedKeys` guard that
  fails on any undocumented write and a coverage lock that fails if a modifier lacks a spec;
  **cross-modifier invariants** — no `apply` yields a non-finite stat or leaves
  `currentHealth > maxHealth` / `maxHealth <= 0`. Stubs the `'../weapons'` boundary (documented
  vitest pattern) so the real `Upgrades.ts` baseline loads in Node. Teeth verified by mutation
  (wrong factor + stray write both caught) then reverted. Pure test addition — no production
  change. Full suite **422 green** (+48), `tsc --noEmit` exit 0.
- `5a00de6` PROPOSE-EVOLUTION-TEST — **add the missing direct unit coverage + a
  data-integrity lock for the weapon-evolution system.** `WeaponEvolutions.ts` (14
  recipes, one per weapon — `getEvolutionForWeapon` / `checkEvolutionReady`) is a
  marquee, pure, multi-consumer module (`WeaponManager.checkEvolutions`, the GameScene
  HUD evolution hint + evolve trigger, `UpgradeScene`) yet had **no test file** — a
  tuning tweak or a typo'd `requiredStatId` could silently ship a weapon that can
  **never evolve**, with nothing to catch it (same "add missing coverage for a pure
  marquee module" vein as PROPOSE-PERFGRADE-TEST `5940c9a` / FEAT-DIRECTOR-PERSIST
  `9a70746`). New `WeaponEvolutions.test.ts` (20 cases): `getEvolutionForWeapon`
  lookup/unknown; `checkEvolutionReady` gating (both gates met, exceeded, unknown
  weapon, weapon-level short, stat absent / below-level, empty stats, match-by-id among
  unrelated upgrades); `evolutionLevelReduction` (lowers only the weapon gate **not**
  the stat gate, floors the effective requirement at 1, default-0 no-op); and the
  durable part — **every recipe is achievable**: exactly one evolution per registry
  weapon (no missing / no orphan), unique weaponIds, every `requiredStatId` resolves to
  a real `createUpgrades()` upgrade reachable to its `requiredStatLevel`,
  requiredWeaponLevel >= 1, non-empty name/desc, >= 1 finite positive multiplier per
  recipe. Integrity cases cross-check the **real** `Upgrades.ts` list (which imports
  WeaponManager for a type → the test stubs `'../weapons'`, the documented vitest
  boundary mock). One-word production change: `export weaponEvolutionDefinitions` so the
  integrity loop can iterate it — no behaviour change. All 14 recipes confirmed
  achievable. Full suite **374 green** (+20), `tsc --noEmit` exit 0, `vite build` clean.
  Self-discovered.
- `2a094e0` PROPOSE-DEADSTAT-LUCK — **wire the dead `luck` stat to bias relic-drop rarity** —
  the **last** write-only PlayerStats field, closing the dead-stat vein. `luck` (`PlayerStats`,
  "chance for better quality upgrades") was written but **never read**: the `luckLevel` shop
  upgrade (+10%/level, maxLevel 5) and the Lucky Charm relic (+10%) both fed it for zero effect,
  so the shop's "+X% rare upgrade chance" text was a lie (same vein as `501b5bc`/`457a755`/
  `4d4386e`). **Design call:** the in-run upgrade modal has no rarity tiers to bias (wiring there
  would be a net-new feature — filed as PROPOSE-UPGRADE-RARITY-TIERS), but the **relic** system
  already has rarity tiers + a weighted roll, so `luck` now biases *that*: the faithful, smallest
  "better quality loot" slice. New pure `luckBiasedRarityWeights(luck)` (`Relics.ts`) scales each
  rarity's base drop weight by `1 + clamp(luck,0,1) * LUCK_RARITY_WEIGHT_BONUS[rarity]` (common 0 /
  rare .5 / epic 1.5 / legendary 3 — higher tiers grow faster; common's absolute weight is
  unchanged so its *share* only shrinks as the good tiers grow). `pickRandomRelic` takes an
  optional `luck` (default 0); `RelicManager.rollAndEquipRandomRelic` passes `stats.luck`, which
  covers **all four** GameScene drop paths through the single roll chokepoint (the direct
  `equipRelic` path has no roll, correctly unaffected). **At luck 0 the weights are byte-identical
  to the old behaviour** — regression-safe for runs without luck; luck clamped `[0,1]`, non-finite/
  undefined (incl. legacy saves missing the field → default param / `Number.isFinite` guard) → 0;
  read live each roll, never accumulated → no double-application on save-restore. Updated the now-
  accurate `PlayerStats.luck` comment. **Test-first: the module's first coverage** —
  `Relics.test.ts` (12 cases): luck-0 regression lock, common-never-boosted, monotonic per-rarity
  boost factor, strictly-rising legendary share, `[0,1]` clamp, non-finite→0, + `pickRandomRelic`
  default-param lock, exclude-id respect across the whole roll range, all-excluded→null, and a
  deterministic common→legendary selection shift at a fixed roll (proves luck biases the real pick
  path). Full suite **354 green** (+12), `tsc --noEmit` exit 0, `vite build` clean. Self-discovered.
  **Closes the dead-stat vein — no write-only PlayerStats field remains.** Drop-rate *feel* unverified
  in bg → see BALANCE-LUCK-DROPS.
- `4d4386e` PROPOSE-DEADSTAT-CHAINCOUNT — **wire the dead `chainLightningCount` stat into
  Chain Lightning's jump count** so the Chain Catalyst relic (+2) and the `chainCountLevel`
  meta upgrade finally add jumps. The stat (`PlayerStats`, "Extra chain targets") was written
  but **never read** — `ChainLightningWeapon.recalculateStats` derived its count purely from
  `base + floor(level/2) + externalBonusCount` (the generic projectile-count bonus) and ignored
  the dedicated stat, so both advertised sources were no-ops (same vein as `501b5bc` synergy /
  `457a755` slowResistance). Now folded in as a fourth additive term that feeds **both** the
  regular chain (`attack`) and the Lightning Conductor mastery web (`attackLightningConductor`,
  which reads `stats.count`). Wired with the established per-frame-sync pattern: a change-guarded
  `WeaponManager.setChainLightningBonusCount` (mirrors `setSynergyBonus`) pushes the stat to the
  chain weapon, re-applied on `addWeapon` so a chain weapon picked up *after* the relic still
  gets the bonus; GameScene's `syncStatsToPlayer` feeds `playerStats.chainLightningCount`. Stored
  separately from the generic count bonus so the two stack. Round-trips on save-restore via the
  baked playerStats (read-and-set each frame, never accumulated → no double-application). **At
  chainLightningCount 0 the jump count is byte-identical to the old formula** — regression-safe
  for runs without the relic/upgrade; the bonus clamps to a finite non-negative integer (a
  corrupt/negative stat is inert, never below the level+generic baseline). Math kept in a pure
  browser-free module (`ChainJumpCount.ts`, mirrors `SlowResistance`/`WeaponSynergies`);
  `BaseWeapon.refreshStats` widened private→protected so the subclass setter can re-trigger a
  refresh. **Test-first:** `ChainJumpCount.test.ts` (7 cases) — chain-bonus-0 regression lock,
  additive stacking, level-flooring, fractional-bonus floor, negative clamp, non-finite inertness.
  Full suite **342 green** (+7), `tsc --noEmit` exit 0, `vite build` clean. Self-discovered.
- `457a755` BUG-SLOWRESIST-DEADSTAT — **wire the dead `slowResistance` stat into the
  Warden slow aura** — the player's only slow source. `slowResistance` (`PlayerStats`) was
  written but **never read**: the only thing that slows the *player* is the Warden enemy's
  aura (`getWardenSlowMultiplier()`, `EnemyAISystem.ts:322` — `*= 0.85` per nearby Warden),
  applied to player `Velocity` in `GameScene` (`:3288`), and that site multiplied by the raw
  slow with no resistance term. So both advertised sources were no-ops: the `slowResistLevel`
  ("Steadfast", +15%/level, a maxed late-game gold sink) permanent upgrade and the
  `relic_frost_ward` ("Frost Ward", +20% slow resist) relic — a player who bought Steadfast or
  picked up Frost Ward got **zero** slow resistance. Same dead-stat vein as `501b5bc`
  (synergy) / `3db4e75`/`d768284`/`4365943` (weapon stats). Now the Warden-slow site routes
  `wardenSlow` through a new pure `resolveSlowAfterResistance(rawSlow, slowResistance)` that
  scales back **only the slow penalty** (the deviation of the multiplier from 1.0): a 0.85
  slow at 0.4 resistance → keeps 60% of the 0.15 penalty → 0.91; resistance 1.0 → full
  immunity (1.0). **At resistance 0 the output is byte-identical to the old `wardenSlow`** —
  pure regression-safe wiring. Resistance clamped `[0,1]` (stacked relic+upgrade can exceed
  1 → caps at immune, never inverts into a speed boost); non-finite resistance (incl. legacy
  saves missing the field → `undefined`) → 0; the `wardenSlow < 1.0` fast-path and a new
  `resistedSlow < 1.0` guard skip the function call / no-op multiply when not slowed / fully
  immune. Shop + relic descriptions ("Resist slow effects" / "X% slow resistance" /
  "+20% slow resist") are now **accurate** — no text change needed (unlike synergy). Round-trips
  on save-restore via the baked `playerStats.slowResistance` (read each frame, never
  accumulated → no double-application). Math kept in a pure browser-free module
  (`src/systems/SlowResistance.ts`, mirrors `TimedStatBuffs`/`computeSynergyMultipliers`) so it
  is unit-testable without a live Phaser scene. **Test-first: the module's first coverage** —
  `SlowResistance.test.ts` (10 cases): resistance-0 regression lock (byte-identical), full
  immunity at 1.0, partial penalty-scaling, >1 clamp, negative clamp, non-finite resistance →
  0, non-slow (raw≥1.0) pass-through, non-finite raw → 1.0, stacked-Warden compounding, output
  bounded `[0,1]`. Full suite **335 green** (+10), `tsc --noEmit` exit 0, `vite build` clean.
  Self-discovered via the dead-stat hunt (see vein note). The hunt is now **exhausted**: of
  every PlayerStats field written by a data file, only `chainLightningCount` and `luck` remain
  write-only (filed as PROPOSE-DEADSTAT-* below); all other low-read fields
  (`attackSpeedMultiplier`/`gemValueMultiplier`/`iframeDuration`/`rangeMultiplier`/
  `projectileSpeedMultiplier`) were verified genuinely consumed.
- `501b5bc` BUG-SYNERGY-DEADSTAT — **wire the dead `weaponSynergy` stat so the "Synergy"
  meta upgrade and "Synergy Chain" legendary relic actually do something.** `weaponSynergy`
  (`PlayerStats`) was written but **never read** — `recalculateSynergies` (`WeaponManager.ts`)
  built its per-weapon damage/cooldown multipliers purely from the raw `WEAPON_SYNERGIES` table
  and ignored the stat. So both its sources were no-ops: the `weaponSynergyLevel` meta upgrade
  (+3%/level, a maxed late-game gold sink) and the legendary `relic_synergy_chain` (+20% weapon
  synergy bonus) — a player spending gold or picking up the legendary got **zero** effect. Same
  class as the "wire dead weapon stats" vein (`3db4e75`/`d768284`/`4365943`). Now `weaponSynergy`
  amplifies the **bonus portion** of every active synergy: a +30% damage synergy → +36% at a 0.2
  bonus, a 15%-faster cooldown → 18% faster; only the deviation from 1.0 is scaled so a no-op
  dimension (multiplier exactly 1.0) stays 1.0, and per-weapon bonuses stack multiplicatively
  (matches existing behaviour). **At bonus 0 the output is byte-identical to the old code** — pure
  regression-safe wiring. Math extracted into a pure exported `computeSynergyMultipliers(ids, bonus)`
  (`WeaponSynergies.ts`, mirrors `computeRunScore`/`computeRunGold`) so it's testable without a live
  Phaser scene. New `WeaponManager.setSynergyBonus()` stores the stat + recalculates only on change;
  GameScene's per-frame `syncStatsToPlayer` feeds it `playerStats.weaponSynergy`, so the meta starting
  bonus applies at run start and a mid-run Synergy Chain pickup re-applies synergies immediately (all
  three relic-grant paths call `syncStatsToPlayer` right after). Round-trips on save-restore via the
  baked `playerStats.weaponSynergy` (relic restore only repopulates the list, never re-applies), so no
  double-application. Non-finite/negative bonuses clamp to 0 (synergies can't invert below base).
  Updated the now-accurate shop effect text (`+X% weapon synergy bonus`, was the misleading
  `+X% damage per weapon`) + the `PlayerStats` field comment. **Test-first: the module's first
  coverage** — `WeaponSynergies.test.ts` (15 cases): getSynergy order-independence + getActiveSynergies
  characterization, then computeSynergyMultipliers — empty/no-pair maps, raw-multiplier baseline
  (bonus 0 = no-op regression lock), damage/cooldown/combined amplification, multi-synergy stacking,
  negative + non-finite clamping. Full suite **325 green** (+15), `tsc --noEmit` exit 0, `vite build`
  clean. Self-discovered.
- `15cdf16` BUG-MUSIC-CORRUPT — **harden `MusicManager`'s SecureStorage loaders against
  corrupt/tampered storage** — the **last** un-hardened loader, closing the corruption vein.
  Two real holes (`src/audio/MusicManager.ts`): (1) `loadVolume` returned `parseFloat(stored)`
  with no finite/range check — the exact BUG-SETTINGS-CORRUPT (`b0377f7`) class: `parseFloat('1e999')`
  is `Infinity`, `parseFloat('loud')` is `NaN`, negatives pass — loading straight into `this.volume`.
  This is **crash-class, not the "BGM prefs only / low-impact" the Proposed-auto vein note assumed:**
  a non-finite volume reaches `gainNode.gain.value = volume * intensity` (`loadTrack:287`/`setVolume:480`/
  `setIntensity:494`), and a non-finite Web Audio `AudioParam` value **throws a TypeError** — and
  `setIntensity` runs **every frame** via `MusicIntensityDriver`, so a NaN/Infinity volume is a per-frame
  exception storm; `getVolume()` also feeds NaN to the MusicSettings slider. Fixed by gating on
  `Number.isFinite` (→ `0.4` default) then clamping `[0,1]`, mirroring `setVolume`. (2) `loadEnabledTracks`
  did `new Set(JSON.parse(stored))` with no shape check — a JSON **string** payload (`"hello"`) is
  iterable and did **not** throw, becoming a `Set` of single chars (garbage ids → empty playlist,
  re-persisted on the next toggle); non-string/unknown array members leaked the same way. Fixed by
  rebuilding from **known catalog ids only** (module-level `CATALOG_IDS` set): keep string members present
  in `MUSIC_CATALOG`, drop non-string junk + stale ids; an **empty array is preserved** as the valid
  "all disabled" state (`disableAllTracks` writes `[]`), a non-array payload falls back to all-enabled.
  `loadPlaybackMode` was already whitelisted (junk-immune) — a characterization test locks it.
  Byte-identical on the real path (valid volumes clamp-noop, valid id arrays are all catalog ids), so
  pure hardening, no behaviour change. **Test-first: the module's first coverage** —
  `MusicManager.test.ts` (15 cases): volume Infinity/NaN/out-of-range/valid-round-trip, the char-Set
  regression, junk-id drop, empty-array preservation, mode whitelist, defaults + setter round-trips.
  Full suite **310 green** (+15), `tsc --noEmit` + `vite build` clean. Self-discovered. **Closes the
  corruption-hardening vein — every SecureStorage loader in the codebase is now hardened.**
- `b0377f7` BUG-SETTINGS-CORRUPT — **harden `SettingsManager`'s numeric loaders against
  out-of-range/Infinity storage.** The setters clamp every numeric setting (sfxVolume `[0,1]`,
  uiScale `[0.5,2.0]` in 0.1 steps, screenShakeIntensity `[0,1]` in 0.01 steps), but the **load
  path did not** — `loadNumber` (`src/settings/SettingsManager.ts`) only rejected NaN (`parseFloat`
  + `!isNaN`) with no range check. Since `parseFloat('1e999')` is `Infinity` and `!isNaN(Infinity)`
  is `true`, a corrupt/tampered value (Infinity, a huge finite, or a negative) loaded straight past
  the setters' clamps. SecureStorage is the anti-cheat layer, so an out-of-range payload is the
  threat model (same vein as `38599e4`/`6de57f7`/`bb7e00f`). **Worst case is screenShakeIntensity:**
  `GameScene.shakeCamera` (`:5429`) does `cameras.main.shake(d, intensity * shakeScale)` with no
  clamp, so an Infinity/huge stored intensity drives an Infinity camera-shake offset → NaN camera
  scroll → the render breaks for the rest of the run, unrecoverable — a crash-class bug, not the
  "UX prefs only" the vein note had assumed. uiScale feeds `HudScale` (every HUD/menu layout;
  partly self-defended by HudScale's own final clamp) and sfxVolume feeds the audio gain on 26
  `SoundManager` call sites — fixing at the load source is the vein principle, not relying on each
  scattered consumer to re-clamp. Fix replaces `loadNumber` with `loadBoundedNumber(key, default,
  min, max, roundFactor)`: rejects non-finite (`Number.isFinite` gate) + unparseable → default,
  rounds finite values to the setter's step, then clamps to `[min,max]`; bounds + round factor per
  call mirror each setter exactly, so the loaded value is always one the setter could itself have
  produced. Byte-identical on the real path (saved values are already clamped + rounded → re-applying
  is a no-op), so pure hardening, no behaviour change for valid data. Booleans (`=== 'true'`) and the
  damage-numbers / colorblind enum loaders (whitelist) were already junk-immune. **Test-first: the
  module's first coverage** — `SettingsManager.test.ts` (19 cases): Infinity/huge/negative/non-numeric
  tamper for all three numeric settings, off-step rounding, the camera-can't-blow-up invariant,
  boolean + enum junk-immunity characterization, the legacy shake-toggle migration, and a valid-value
  round-trip locking the real path unchanged. Full suite **295 green** (+19), `tsc --noEmit` + `vite
  build` clean. Self-discovered. **Closes all high-value hardening; only `MusicManager` (BGM prefs,
  genuinely low-impact) remains un-hardened — see the Proposed-auto vein note.**
- `38599e4` BUG-CODEX-CORRUPT — **harden `CodexManager` against corrupt/tampered codex storage.**
  `loadState` (`src/codex/CodexManager.ts`) spread `...parsed.weapons` / `...parsed.enemies` /
  `...parsed.upgrades` / `...parsed.statistics` straight over the seeded defaults. SecureStorage is
  the anti-cheat layer, so a corrupt/tampered/non-object `survivor-codex` payload is the threat model
  (siblings BUG-ACHIEVE-CORRUPT `6de57f7`, BUG-METAPROG-CORRUPT `1232d43`, BUG-ASCENSION-CORRUPT
  `bb7e00f`). Three holes: (1) injected weapon/enemy ids were retained, inflating
  `getTotalWeaponCount`/`getTotalEnemyCount` → skewing `getCompletionPercent` (the codex %); (2)
  `discovered` was never coerced, so a truthy non-boolean (`"yes"`/`1`) faked a discovery — and weapon
  discovery **gates the starting-weapon picks in `WeaponSelectScene`**, so this is unlock-poisoning, not
  just display; (3) non-numeric/Infinity/negative entry + statistics fields leaked NaN/garbage into the
  CodexScene stats panel. **Also fixes a latent real-path bug:** `JSON.stringify(Infinity) === "null"`,
  so `fastestVictorySeconds` (default Infinity) round-tripped to `null` after the first saved run;
  `CodexScene.ts:655` renders `fastestVictorySeconds < Infinity ? formatTime : '--:--'` and
  `null < Infinity` is true → it showed a garbage fastest-victory time instead of `--:--`, and
  fastest-victory tracking silently broke (same class as `6de57f7`). Fix mirrors the vein: an
  `asStoredRecord` guard degrades non-objects to `{}`, a `boundedStoredNumber(value, fallback, spec)`
  helper coerces each field through a finite, non-negative check (per-field floor via a
  compiler-enforced `Record<keyof CodexStatistics,…>` spec table; an `allowInfinity` carve-out for the
  fastest-victory sentinel), and `loadState` **rebuilds weapons/enemies/statistics from the known
  ids/fields only** — dropping junk keys and forcing `discovered` to a real boolean. Dynamic upgrade ids
  (no fixed known set) keep every entry whose value is a real object (id from the authoritative map key),
  dropping scalar/array junk. Byte-identical on the real path (valid ints floor-noop, fractional
  damage/seconds preserved, Infinity restored), so pure hardening, no balance change. **Test-first: the
  module's first coverage** — `CodexManager.corruption.test.ts` (21 cases): valid round-trip +
  completion-% characterization, non-object/malformed-payload fallbacks, junk-id drop (stable totals),
  the strict-boolean discovery guard, per-field numeric coercion, the Infinity sentinel, the
  null→Infinity real-path regression (save+reload through the real save path), and dynamic upgrade-id
  handling. Full suite **276 green** (+21), `tsc` + `vite build` clean. Self-discovered.
- `6de57f7` BUG-ACHIEVE-CORRUPT — **harden `AchievementManager` against corrupt/tampered
  achievement storage.** `loadPersistentState` (`src/achievements/AchievementManager.ts`) spread
  `...parsed.lifetimeStats` / `...parsed.achievements` straight over defaults, so a corrupt/tampered
  `survivor-achievements` payload leaked junk into gameplay (SecureStorage is the anti-cheat layer →
  a non-object/non-numeric payload is the threat model; siblings BUG-METAPROG-CORRUPT `1232d43`,
  BUG-ASCENSION-CORRUPT `bb7e00f`). The damage is amplified by `recordRunEnd`'s
  `stats.totalKills += ...` accumulation: a single NaN/string lifetime stat poisons the **persisted**
  total forever (NaN, or string-concat like `"abc100"`), then every `currentValue >= targetValue`
  check goes false → the achievement is **permanently bricked**; the same lifetime totals feed
  `HiddenUnlocks` predicates (a NaN dead-locks an unlock; an inflated `1e999` spuriously unlocks
  ships/cosmetics/stages — `totalRunsCompleted >= 1`, `totalKills >= 10_000`, `highestWorldLevel >= 5`,
  …) and render as `"NaN"` in the Achievement/Leaderboard UI. A second hole: `isUnlocked` was never
  coerced, so a truthy non-boolean tamper (`"yes"`) faked an unlock — inflating completion % +
  re-delivering rewards — and the wholesale spread retained unknown junk ids. Fix: a
  `boundedStoredNumber` helper coerces each field through a finite, non-negative check (per-field floor
  for integer counters via a compiler-enforced `Record<keyof LifetimeStats,…>` spec table; an
  `allowInfinity` carve-out for `fastestVictorySeconds`' "none yet" sentinel), and both loaders
  **rebuild from the known fields/ids only** — dropping junk keys and forcing `isUnlocked`/
  `rewardClaimed` to real booleans. Byte-identical on the real path (valid ints floor-noop, fractional
  damage/seconds preserved, Infinity preserved), so pure hardening, no balance change. **Also fixes a
  latent real-path bug:** `JSON.stringify(Infinity) === "null"`, so after any saved run
  `fastestVictorySeconds` round-tripped to `null`, making `survivalTimeSeconds < null` (→ `< 0`) false
  forever and silently disabling all future fastest-victory tracking — the sanitizer restores the
  Infinity default. **Test-first: the module's first coverage** — `AchievementManager.corruption.test.ts`
  (24 cases): per-field numeric coercion, the Infinity sentinel, junk-key drop, the boolean-unlock guard,
  the un-brick regression (tampered string `totalKills` + 100 kills → unlocks `lifetime_kills_100`),
  top-level payload guards, + characterization locking the valid round-trip and the null→Infinity fix.
  Full suite **255 green** (+24), `tsc` + `vite build` clean. Self-discovered.
- `1232d43` BUG-METAPROG-CORRUPT — **harden `MetaProgressionManager`'s three JSON loaders against
  corrupt/tampered storage.** `loadStreakState`, `loadUpgradeState`, and `loadAchievementBonuses`
  (`src/meta/MetaProgressionManager.ts`) each hand-rolled the `Math.max(0, Math.min(value, cap))`
  clamp that leaks NaN — `Math.min("abc", cap)` is NaN, `Math.max(0, NaN)` stays NaN (the exact
  BUG-ASCENSION-CORRUPT `bb7e00f` / BUG-COMBO-RESTORE-CORRUPT `2a283e0` class). Streak used
  `parsed.currentStreak ?? 0` (`?? 0` only catches null/undefined, so a non-numeric field slips
  through); upgrades + achievement bonuses spread `{...defaults, ...parsed}` then clamped, so a
  non-numeric field became a NaN level/bonus. SecureStorage is the anti-cheat layer, so a
  non-object/non-numeric payload is the threat model — this manager (gold, all permanent upgrades,
  world level, streak, achievement stat bonuses) is the most central one and was the last scoring/meta
  module without load-time hardening. Impact of a NaN: a NaN streak → `getStreakGoldMultiplier` NaN →
  `calculateRunGold` streakMultiplier NaN → `Math.floor(gold × NaN)` = NaN run gold → corrupt
  *persisted* balance + `×NaN` in the pause/shop UI; a NaN upgrade level → `level()` returns it (`?? 0`
  misses NaN too) → `getAccountLevel` NaN (breaks unlock + ascension-threshold gating) and every
  `getStartingXXX()` NaN → NaN PlayerStats at run start; a NaN achievement bonus → NaN PlayerStats via
  GameScene's run-start apply (`:823`). A **second, distinct** hole: `calculateAccountLevel` sums
  `Object.values(upgradeState)`, and the old wholesale spread kept *unknown* keys — a tampered
  array/extra-key payload (e.g. `{"__hack":999999}`) inflated the account level and spuriously
  unlocked everything / met the ascension threshold. Fix: a `boundedStoredNumber(value, min, max,
  fallback, floorToInt)` helper coerces each field through a finite check (non-number/NaN/Infinity →
  fallback) then floors (counts) + clamps; an `asStoredRecord` guard degrades non-objects to `{}`; and
  both object loaders now **rebuild from the known ids/fields only**, dropping junk keys. Byte-identical
  on the real path (saved keys are exactly the current upgrade ids; valid int levels floor-noop +
  clamp the same; percent bonuses left unfloored), so pure hardening, no balance change — the shared
  `MetaProgressionManager.gold.test.ts` still passes unchanged. **Test-first: the module's first
  corruption coverage** — `MetaProgressionManager.corruption.test.ts` (26 cases): per-loader
  non-numeric/object/Infinity/negative/over-cap/fractional/non-object-payload tamper locks, the
  junk-key account-level-inflation regression, + characterization that valid streak/levels/bonuses
  round-trip unchanged and a missing newer upgrade id still defaults to 0. Full suite **231 green**
  (+26), `tsc` + `vite build` clean. Self-discovered.
- `bb7e00f` BUG-ASCENSION-CORRUPT — **harden `AscensionManager` against corrupt/tampered ascension
  state.** `loadState` (`src/meta/AscensionManager.ts`) parsed `survivor-meta-ascension` with
  `Math.max(0, Math.min(parsed.level ?? 0, 50))`. `?? 0` only catches null/undefined, so a
  non-numeric tampered value (a string/object) slipped through and `Math.min("abc", 50)` is NaN →
  `Math.max(0, NaN)` is NaN → the loaded `level` became NaN (`1e999`, which JSON.parse reads back as
  Infinity, also leaked through as a max-grant). SecureStorage is the anti-cheat layer, so a
  non-numeric/overflow payload is exactly the threat model (siblings: BUG-BESTSCORE-CORRUPT `0b81956`,
  BUG-COMBO-RESTORE-CORRUPT `2a283e0`). A NaN ascension level poisons the whole prestige system:
  `getStatMultiplier()`/`getGoldMultiplier()` return NaN — the gold multiplier feeds
  `MetaProgressionManager.calculateRunGold` (`ascensionMultiplier`, `:1184`) → NaN run gold → corrupt
  persisted balance, and both render as "NaN" in the shop/boot/pause UI; `getAscensionThreshold()`
  returns NaN, so `canAscend()` (`accountLevel >= NaN`) is false **forever** → re-ascension permanently
  bricked. (GameScene's run-start stat apply happens to guard with `if (mult > 1)`, but the gold path,
  threshold/canAscend, and the UI displays are all unguarded — so the fix is at the load source, not
  per-consumer.) Fix: a `toBoundedCount` helper coerces each counter through a finite check (rejecting
  non-numbers and Infinity → 0), floors it, and clamps to `[0, MAX_ASCENSION_LEVEL]` (the magic 50,
  now named). Byte-identical on the real path (saved levels are always finite ints in range), so pure
  hardening, no balance change. **Test-first: the module's first coverage** — `AscensionManager.test.ts`
  (24 cases): tamper locks (non-numeric string/object → 0, `1e999`/`-1e999` → 0, fractional floored,
  negative/over-cap clamped, null-field/null/array/primitive/non-JSON → defaults) + characterization of
  the multiplier/threshold/canAscend/bonus-tier/performAscension contract. Full suite **205 green**
  (+24), `tsc` + `vite build` clean. Self-discovered.
- `2a283e0` BUG-COMBO-RESTORE-CORRUPT — **harden `restoreComboState` against corrupt/tampered save
  state.** `restoreComboState` (`src/systems/ComboSystem.ts`) assigned `comboCount`/`comboDecayTimer`/
  `highestCombo` straight from the save snapshot with no validation. `comboState` is an *optional* save
  field, so `GameStateManager.isStructurallyValidSaveState` deliberately skips it ("newer optional fields
  are guarded at their own use sites") — but this use site did no guarding. Since the save is persisted via
  SecureStorage (a tamper/corruption surface — the reason the store is encrypted), a garbage snapshot set
  `comboCount` to NaN/undefined/string → `getComboXPMultiplier()` returns NaN, poisoning live XP gain
  mid-run, and set `highestCombo` to a NaN/inflated value that flows into `PerformanceGrade.computeRunScore`
  (`highestCombo × 5`) → the persisted best score, the daily-challenge leaderboard rank, and achievement /
  hidden-unlock records. Fix coerces every field through `toFiniteNonNegative` (mirrors
  `BestScoreManager.isValidStoredScore` from BUG-BESTSCORE-CORRUPT): combo + highest floored to finite
  non-negative ints, decay timer clamped to the combo's grace delay (a tampered "infinite grace" can't
  freeze a combo), `highestCombo >= comboCount` invariant held. Valid saves unchanged. New
  `ComboSystem.test.ts` (16 cases): 10 corruption/tamper + 6 characterization locking the
  tier/threshold/XP-multiplier contract. Full suite **181 green**, build clean. Self-discovered.
- `5940c9a` PROPOSE-PERFGRADE-TEST — **add the missing direct unit coverage for PerformanceGrade.**
  `computeRunScore` + `computePerformanceGrade` (`src/utils/PerformanceGrade.ts`) are the canonical
  run-scoring + grade contract shared by four consumers — `BestScoreManager` (persisted best),
  `DailyChallengeManager` (leaderboard rank), `RunHistoryManager` (recorded run summaries), and the
  S–F results badge (`GameScene` victory + game-over paths) — yet had **no direct test file** (only
  exercised indirectly), so a tuning tweak to a weight or threshold could silently shift leaderboard
  ordering or grade cutoffs. New `PerformanceGrade.test.ts` (34 cases, pure/browser-free, no Phaser
  or storage mock): `computeRunScore` — all-zero=0, each term's documented weight (kills×10/survival×3/
  level×50/damage÷100/combo×5), victory +5000 exactly, `Math.round` half-up rounding, determinism, full
  composite; `computePerformanceGrade` — every grade cutoff + just-below boundary at world level 1,
  world-level baseline scaling (same score grades lower at higher WL; S at WL5 needs 5× the score),
  `worldLevel<=0` clamp to baseline 4000, victory +1-tier bump (F→D, A→S) capped at S (no overflow),
  palette color per grade, defensive numeric edges (negative→F, NaN→F no-throw, Infinity→S). No
  production code changed — pure regression lock (precedent: `9a70746`). `npm run test` **165/165 green**
  (+34), `tsc && vite build` clean.
- `0b81956` BUG-BESTSCORE-CORRUPT — **harden BestScoreManager against corrupt/tampered
  best-score storage.** `load()` parsed `survivor-best-scores` with no shape check
  (`cache = JSON.parse(stored) as BestScoreMap`), so a corrupt/tampered/truncated payload
  broke the post-run results screen: a `"null"` payload made `load()` return null, then
  `recordScore`'s `map[key] = score` (run via `showVictory`/`gameOver` at **every** run end —
  `GameScene:4061`/`:4335`) threw a TypeError so the overlay never rendered; an array/primitive
  payload got indexed by world-level keys, and non-numeric/NaN entries surfaced a garbage/NaN
  "best". SecureStorage is the anti-cheat layer, so a non-object payload is exactly the threat
  model — this was the lone scoring-persistence module without the FEAT-SAVE-VALIDATE
  (`4dccd79`) / RunHistoryManager hardening. Fix: `load()` validates the parsed value is a plain
  object and keeps only finite non-negative numeric entries; `recordScore` sanitizes its score
  to a finite non-negative integer. Also dropped the stale module cache for **read-through**
  reads (single source of truth, mirroring RunHistoryManager) — removes a secondary foot-gun
  where a falsy-parsed cache silently re-parsed every call, and self-heals the stored payload on
  the next write. Byte-identical on the real path (`computeRunScore` always yields a finite
  non-negative int), so pure hardening, no balance change. **Test-first: the module's first
  coverage** — `BestScoreManager.test.ts` (15 cases): record/read-back, strictly-greater
  overwrite, per-world-level isolation, persistence, + corruption locks (null/array/primitive/
  non-JSON payloads, dropped invalid entries, NaN/Infinity sanitization). `npm run test`
  **131/131 green** (+15), `tsc && vite build` clean.
- `2b82b20` BUG-STREAKER-NOTASTREAK — **make the Streak Flame hidden unlock require a real
  5-win streak instead of 5 total victories.** The `unlock_streaker` condition (hint: "Win 5
  runs in a row") gated on `run.wasVictory && lifetime.totalVictories % 5 === 0 &&
  totalVictories >= 5` — total lifetime wins, not consecutive. It unlocked the Streak Flame
  cosmetic on the 5th win *ever* regardless of losses between them, contradicting its own hint;
  and because `evaluatePostRun` fires each condition at most once (dedupe), the `% 5` modulo was
  dead logic (could only match at the first multiple reached). Fix threads the actual
  consecutive-win count into the unlock-eval context as `run.winStreak` (sourced from
  `MetaProgressionManager.getCurrentStreak()` — `LifetimeStats` has no streak field, so it must
  be passed explicitly) and gates on `winStreak >= 5`. Both run-end call sites fixed for correct
  ordering: `showVictory()` now evaluates unlocks *after* `incrementStreak()` so it sees the
  streak the win produced (was off-by-one — saw 4 on the 5th consecutive win); `gameOver()`
  passes `getCurrentStreak()` (0 after `breakStreak()` on a loss, intact for a won-then-died
  endless run, `wasVictory` double-guards the loss). **Test-first: the module's first coverage**
  — `HiddenUnlocks.test.ts` (14 cases): streaker at streak 5 / not 4 / not on loss / not from
  scattered lifetime wins (old-bug regression lock), evaluatePostRun unlock + dedupe + callback,
  sibling predicate guards, getTopProgress sort / boolean-only exclusion / zero-progress skip.
  `npm run test` **116/116 green** (+14), `tsc && vite build` clean.
- `d0b2a5b` BUG-NEWCOMER-DOUBLEBURN — **count each run once for the newcomer gold bonus +
  make the run-gold formula pure.** `MetaProgressionManager.calculateRunGold` mutated
  `runsCompleted` (++ and save) as a side effect — a "calculate" method advancing state.
  It is called once in `showVictory()` (boss kill) and once in `gameOver()` (death); for a
  **win that continues into endless mode and then dies, BOTH fire for the same run**, so the
  run counted twice and burned the first-runs newcomer gold taper (3.0×→1.5× over the first
  five runs, 1.25× through run nine) twice as fast — quietly cutting a new player's early
  gold. Also a latent landmine: any future gold *preview* would double-count. Fix splits the
  concern: extracted pure exported `computeRunGold(params)` (all meta multipliers passed in
  explicitly) + `newcomerMultiplierForRuns(runs)`, mirroring `PerformanceGrade.computeRunScore`;
  the flooring sequence + per-multiplier conditionals are preserved exactly so awarded gold is
  byte-for-byte unchanged on every path. `calculateRunGold` is now a pure read; new
  `recordRunCompleted()` owns the counter advance, called once per run by GameScene **after**
  the result render — unconditional in `showVictory()` (fires ≤once/run), guarded by `!hasWon`
  in `gameOver()` (a won-then-died endless run was already counted). After-render placement
  also fixes a pre-existing display bug: the victory screen's "Newcomer Bonus N×" line read the
  post-increment tier while the gold used the pre-increment tier. **Test-first: 14 cases**
  (`MetaProgressionManager.gold.test.ts`) — base formula, 50-gold floor, victory ×1.5, each
  multiplier, full stack with per-step flooring, taper tiers, + regression locks (calculate
  doesn't advance the counter; recordRunCompleted advances by exactly one). `npm run test`
  **102/102 green** (+14), `tsc && vite build` clean.
- `45fdd74` FEAT-DAILY-SCORE — **rank the daily-challenge leaderboard by composite run
  score + record daily victories.** Two self-discovered correctness bugs in
  `DailyChallengeManager`: (1) `recordDailyRun` was only called from `gameOver()` (the
  death path), so a **won** daily run — which flows through `showVictory()` — never posted
  to the leaderboard at all; added the record call to the victory path (guarded by daily
  mode). (2) "Best" used an ad-hoc `kills > survival > level` comparison, diverging from
  the unified `computeRunScore` (PerformanceGrade) used by the grade / BestScoreManager /
  run history — so a clearly better run (victory, high combo/damage, one fewer kill) could
  lose. `DailyLeaderboardEntry` now carries `score`; `isRunBetter` ranks by it (kills/
  survival/level only break exact ties). Both GameScene run-end paths pass `runScore`.
  Legacy entries (pre-`score`) are backfilled on load via `computeRunScore` (combo/damage
  unknown → 0) so old/new rank fairly; `loadLeaderboard` also drops non-object junk.
  Display: LeaderboardScene gains a SCORE column (row widened 720→800), BootScene best-chip
  leads with the score. **Test-first: 11 cases** (`DailyChallengeManager.test.ts`) — score
  ranking, fewer-kills-higher-score wins, tie-breaks, legacy normalization, corrupt payload,
  recents ordering, deterministic generation. `npm run test` **88/88 green** (+11), `tsc`
  + `vite build` clean. Display placement (new column / longer chip) not visually verified
  in bg → see POLISH note below if it crowds at UI-scale extremes.
- `9a70746` FEAT-DIRECTOR-PERSIST — **add the missing director-state round-trip test.**
  `DirectorSystem`'s credit-budget state (`creditBalance`/`creditsEarned`/`currentStrategy`/
  `lastGameTime`) was already serialized end-to-end — `GameStateManager` carries
  `directorState?` as a pass-through (`:319`/`:547`/`:611`), `GameScene` saves (`:1200`) +
  restores (`:1352`) it — but it was the lone refresh-persist feature without a
  `GameStateManager.<feature>.test.ts` guarding it (siblings: bounty/shrine/chest/event/
  statbuff/evolution/consumable). New `GameStateManager.director.test.ts` (3 cases) mirrors
  the siblings: a mid-run round-trip (rolled strategy not reset, accrued credits preserved),
  faithful round-trip of all four strategy values, and a legacy absent→undefined backward-compat
  case. No production code changed — pure regression lock on already-shipped wiring.
  `npm run test` **77/77 green** (+3), `tsc && vite build` clean.
- `4dccd79` FEAT-SAVE-VALIDATE — **reject structurally corrupt saves on load.**
  `readValidSaveState` only checked `version`, so a version-valid but structurally
  broken save (a quota-truncated write, NaN coordinates, a missing entity array) passed
  straight into the GameScene restore path and crashed it — the player couldn't even
  start a run. New pure, exported `isStructurallyValidSaveState(parsed)` validates the
  always-written fields the restore path dereferences unguarded: core/timer/world-scale
  numbers (finite), `playerStats` + its vitals (`level`/`maxHealth`/`currentHealth`), the
  iterated collections (`entities`/`weapons`/`upgrades`/`twinLinks`/`minibossSpawnTimes`/
  `banishedUpgradeIds` must be arrays), and each entity's transform coords (finite).
  Anything broken → `null` → clean fresh start instead of a crashing restore; `hasSave()`/
  `getSaveInfo()` go false too, so BootScene never offers a broken restore. Newer optional
  fields (directorState/eventState/relicIds/…) stay optional — guarded at their use sites —
  so legacy saves keep loading (no over-rejection). **Test-first: 19 cases**
  (`GameStateManager.validate.test.ts`) — pure validator shape checks incl. a complete
  save accepted, version/number/array/playerStats/transform corruption rejected, plus
  manager-level `load()`/`hasSave()` rejection of truncated + version-valid-but-corrupt
  payloads. `npm run test` **74/74 green**, `tsc --noEmit` exit 0, `npm run build` clean.
- `899a4c7` + `606be11` FEAT-RUN-HISTORY — persistent **recent-run history** + a "RECENT"
  trend strip on the end screens. The game tracked aggregate lifetime stats
  (AchievementManager) and a daily-only leaderboard, but nothing remembered individual
  recent runs. New pure `RunHistoryManager` (`src/meta/RunHistoryManager.ts`) persists a
  capped (`MAX_RUN_HISTORY`=10) newest-first list of run summaries (timestamp / duration /
  kills / level / score / grade / victory / worldLevel) via SecureStorage, mirroring
  `BestScoreManager`. Read-through (no cache → store is the single source of truth);
  `load()` validates each entry (`isRunSummary`) and tolerates corrupt / non-array /
  partial payloads (→ `[]`). Key `survivor-run-history` registered in `StorageBootstrap`.
  Both `GameScene` run-end paths (victory + game over) record next to `recordScore`,
  reading the prior runs first so the overlay shows the runs *leading up to* this one.
  `PauseMenuManager.createRecentRunsStrip` (shared by both overlays) draws a compact
  left-margin strip — grade letter, duration, score per row, grade-tinted, ✓ for prior
  wins; no-op on empty history. **Fully test-first: 12 manager tests** (ordering, cap,
  limit clamp, persistence, corrupt-JSON / non-array / malformed-entry resilience).
  `npm run test` **55/55 green**, `tsc --noEmit` exit 0, `npm run build` clean. Visual
  placement unverified in bg → POLISH-RUN-HISTORY (Needs playtest).
- `b209617` FIX BUG-EVENT-BUFF-REVERT (Elite Surge / Golden Tide part) — the last two timed
  events now survive refresh-recovery, closing the whole bug class. Both applied a raw
  `xpMultiplier *= 2` (Elite Surge) / `gemValueMultiplier *= 3` (Golden Tide) reverted by a Phaser
  `delayedCall` — a timer that dies on reload while the save bakes the already-multiplied stat, so a
  mid-event refresh left the boon **permanent** (same class as `d7ab577` Power Surge / `eb16e16`
  power-shrine). Fix **generalised** the damage-only `TimedDamageBuffs` system into a stat-keyed
  `TimedStatBuffs` (`src/systems/TimedStatBuffs.ts`): each buff now carries a `stat`
  (`damageMultiplier` | `xpMultiplier` | `gemValueMultiplier`), `expireTimedStatBuffs` groups the
  revert divisor per stat, and `normalizeTimedStatBuffs` defaults a missing `stat` →
  `damageMultiplier` for legacy saves. `EventSystem.getEventDamageBuff` → `getEventStatBuff` now
  maps power_surge/elite_surge/golden_tide → `{stat, magnitude, durationSeconds}` (new
  `ELITE_SURGE_XP_MULT`/`GOLDEN_TIDE_GEM_MULT` consts). `GameScene.handleRunEvent` routes all three
  boons through the gameTime-keyed list (deleting the dead delayedCalls); Elite Surge keeps only its
  transient `spawnInterval *= 0.5` kick (no revert needed — the spawn loop recomputes spawnInterval
  from the phase curve each spawn tick, so it self-corrects; the old `1.0 - gameTime*0.01` revert
  formula was already overwritten anyway). Save key stays `timedDamageBuffs` for back-compat; entries
  now serialise `stat`. Backward-compatible (no save-version bump). Unit tests: `TimedStatBuffs.test.ts`
  (per-stat expiry + legacy normalize), `EventSystem.test.ts` (getEventStatBuff for all 3 + nulls),
  `GameStateManager.statbuff.test.ts` (stat-keyed + legacy round-trip). **`npm run test` 43/43 green,
  `tsc --noEmit` exit 0, `npm run build` clean.**
- `d7ab577` FIX BUG-EVENT-BUFF-REVERT (power_surge part) — make the **Power Surge** event's 2×
  damage boost survive refresh-recovery. It applied `damageMultiplier *= 2` reverted by a Phaser
  `delayedCall` — a timer that dies on reload while the save bakes the doubled multiplier, so a
  mid-event refresh left **permanent** double damage (same class as the `eb16e16` power-shrine fix).
  Now routed through the gameTime-keyed `timedDamageBuffs` list: new pure `getEventDamageBuff(event)`
  maps power_surge → `{magnitude: 2, durationSeconds: event.duration}` (duration sourced from the
  event def via new `POWER_SURGE_DAMAGE_MULT`); `handleRunEvent` applies it via the existing
  `applyTimedDamageBuff`, so it serializes, restores, and reverts at the correct absolute `gameTime`.
  With `b94d020`, both the HUD indicator and the stat revert now survive reload. Unit tests for the
  mapping (`EventSystem.test.ts`). `tsc` + `npm run build` + 38-test suite green. Elite Surge /
  Golden Tide have the same latent bug → filed BUG-EVENT-BUFF-REVERT (Open).
- `b94d020` FEAT-PERSIST-ACTIVE-EVENT — persist the **live in-run event** (Elite Surge / Golden
  Tide / Power Surge) across refresh-recovery. EventSystem save/restore only round-tripped the
  event-trigger timer, so a mid-event refresh dropped the remainder of the active boon and let the
  trigger timer resume early. `getEventState()` now also emits the live event as
  `{id, remainingTime}`; `restoreEventState()` re-derives the full `RunEvent` def from `EVENT_POOL`
  by id (unknown id / non-positive time → cleared), mirroring how restored affixes/evolutions
  re-derive from their defs. `GameStateManager.eventState` type widened for the optional
  `activeEvent` (pure pass-through). Backward-compatible (absent → none restored, no version bump).
  Unit tests: EventSystem round-trip/legacy/null/unknown-id/non-positive/tick-down/reset, plus a
  GameStateManager save→load round-trip. (Was uncommitted WIP from a bash-dead session; verified +
  committed this session — `npm run test` green.)
- `d2a425a` FEAT-PERSIST-EVOLUTION + FEAT-PERSIST-CHEST — persist **weapon evolutions** and
  **on-field treasure chests** across refresh-recovery (same vein as the FEAT-PERSIST-* chain).
  *Evolutions:* `SerializedWeapon` saved only `{id, level}`, so restore re-created + leveled
  weapons but never re-applied `evolve()` — an evolved super-form (permanent dmg/cooldown/count
  multipliers + evolved name) reverted to base form and came back `isEvolved=false`, so the next
  level-up spuriously re-fired the EVOLVED modal. Now serialize `evolved?: boolean`; restore
  re-derives the recipe by id via `getEvolutionForWeapon()` and calls `evolve()` after the
  levelUp loop (order-independent — `evolve()` mutates `baseStats`, not level). Multipliers
  re-derived from recipe, not serialized (mirrors affix-restore `ecc372a`). *Chests:* on-field
  XP/relic caches were GameScene-owned graphics cleared by `resetInRunFeatureState`, so a refresh
  despawned uncollected chests (lost XP burst + 35%/100% relic) and restarted the spawn clock.
  Now tracked in `activeChests`, serialized `{x, y, isSpecial}` (live drifting position), re-added
  via new shared `addTreasureChest()` helper (extracted from `spawnTreasureChest` so fresh +
  restore build identical chests); restore deferred past playerStats (reads `chestDroneDelay`),
  coords sanitized; collect/despawn unified into one idempotent `cleanup()`. Both
  backward-compatible (absent = not evolved / no chests; no save-version bump). Unit tests:
  evolution round-trip + legacy (`GameStateManager.evolution.test.ts`), chest round-trip + empty
  + legacy (`GameStateManager.chest.test.ts`). Verified **`npm run test` green (21 passed)** and
  `tsc --noEmit` clean — vitest ran to completion this session (see env note). Also gitignore
  `*.log`.
- `5c40cc1` FEAT-PERSIST-SHRINES — persist on-field **walk-in shrines**
  (Cleanse/Power/Fortune/Sacrifice) + their spawn timer across refresh-recovery. Sibling gap to
  FEAT-PERSIST-BOUNTY (`869a146`): shrines are GameScene-owned and cleared by
  `resetInRunFeatureState` on the restore path, so a mid-run refresh despawned placed altars and
  restarted the 38s spawn clock. Serialized as optional `shrineState` (`{ type, x, y }[]` +
  `spawnTimer`) on `GameSaveState`, mirroring the `bountyState`/`comboState` round-trip;
  `restoreGameState` re-draws each altar after `resetInRunFeatureState` via a new shared
  `addShrine()` helper extracted from `spawnShrine` (so fresh + restore draw identical shrines).
  Restored types validated against `SHRINE_DEFS`; absent on legacy saves → reset defaults win
  (backward-compatible, no save-version bump). Unit tests: 3 round-trip cases
  (`GameStateManager.shrine.test.ts`). Verified `tsc --noEmit` clean; Vitest round-trip **unrun**
  in the sandboxed bg shell (see env note) — confirm with `npm run test` on a normal shell.
- `869a146` FEAT-PERSIST-BOUNTY — persist the **in-run bounty** (objective kind/target/
  progress/time-left + inter-bounty cooldown + flawless-broken flag) across refresh-recovery.
  Bounty state was GameScene-owned and cleared by `resetInRunFeatureState` on the restore
  path, so a refresh mid-bounty wiped progress and restarted the cooldown. Now serialized as
  optional `bountyState` on `GameSaveState`, mirroring the `comboState`/`eventState`/
  `timedDamageBuffs` round-trip: `saveGameState` emits it; `restoreGameState` re-applies it
  after `resetInRunFeatureState` (guarded → legacy saves keep reset defaults; no save-version
  bump). `bountyText` HUD label re-creates lazily. Unit tests: 3 round-trip cases
  (`GameStateManager.bounty.test.ts`). Verified `tsc --noEmit` clean; **Vitest round-trip
  still unrun** (sandboxed bg shell can't run it — see the env note under FEAT-PERSIST-SHRINES;
  confirm with `npm run test` on a normal shell).
- `eb16e16` FEAT-PERSIST-POWERBUFF — persist the **Power-shrine damage buff** across
  refresh-recovery. The buff's revert was a Phaser `delayedCall` that dies on reload,
  while the save serialized the already-doubled `damageMultiplier` → reload mid-buff left
  the player permanently double-damage. Replaced the one-shot timer with gameTime-driven
  timed buffs: each records magnitude + an absolute `gameTime` expiry, reverted per frame
  by new pure helper `expireTimedDamageBuffs` (`src/systems/TimedDamageBuffs.ts`).
  Serialized as `timedDamageBuffs` in `GameSaveState`; since `gameTime` restores verbatim,
  the list round-trips and reverts at the right moment (no re-schedule, no re-apply).
  Stacking handled; buff now pauses with the game. Backward-compatible (`?? []`, no
  version bump). Unit tests: pure expiry helper + GameStateManager round-trip.
- `f481aff` FEAT-PERSIST-CONSUMABLES — persist floor **consumables** (BOMB/FREEZE/
  VACUUM/GOLD) across refresh-recovery. New `'consumable'` EntityTag +
  `consumablePickupQuery` + `serializeConsumable` in `GameStateManager` (round-trips
  `kind`/`value`/`magnetized`); `restoreConsumable` in GameScene re-spawns via
  `spawnConsumablePickup`. Mirrors the magnet-pickup serialize/restore pattern;
  magnetized flag re-arms on proximity (not restored, matching siblings).
  Backward-compatible (absent `consumableData` = none restored; no save-version bump).
  Also introduces the repo's first **Vitest** harness (`vitest.config.ts`, 3 round-trip
  tests in `src/save/GameStateManager.consumable.test.ts`, storage module mocked).
- `ecc372a` FEAT-PERSIST (affix part) — persist elite **affixes** across refresh.
  `restoreEnemy` now re-attaches the `EnemyAffix` component (was lost → affixed enemies
  came back as normal-but-tanky: no ring/HP-bar, no volatile/vampiric/blessed behaviour,
  missed elite-kill bounties). Serialize `affixType` in `SerializedEnemyData`; restore
  re-applies the affix's flat armor (only stat re-derived from base type, not serialized).
  Backward-compatible (absent/0 = no affix; no save-version bump). Remaining FEAT-PERSIST
  parts split into FEAT-PERSIST-CONSUMABLES + FEAT-PERSIST-POWERBUFF.
- `dc6d2a3` FEAT-VICTORY-GRADE — show S–F performance grade badge + run/best
  score on the victory screen (parity with the game-over overlay). `VictoryData`
  extended; `GameScene.showVictory` now captures the `recordScore` result + grade.
- `15e2797` Fix game-over best-panel overflow (combo int at source + renderer hardening) + gate run start on intro overlay dismissal.
- `e60d28e` Fix review findings across the 10 new features (gold-mult dead write,
  shrine HP no-op, ripple crash on crates, restore-path resets, victory world-level,
  auto-buy overflow scoring, minion affixes, volatile recursion, aura/heal on crates).
- `562da73` FEAT pre-run Pacts mutator picker (PactSelectScene + `src/data/Pacts.ts`).
- `2d0824c` FEAT post-run performance grade + per-run best score (`PerformanceGrade`,
  `BestScoreManager`) on the results overlay.
- `468a883` FEAT dynamic music intensity (`MusicIntensityDriver` + `MusicManager.setIntensity`).
- `e7a67a7` FEAT in-run bounties (rotating objectives + HUD banner + reward).
- `ecf82bc` FEAT walk-in field shrines (Cleanse/Power/Fortune/Sacrifice).
- `fcc1921` FEAT environmental destructibles (crates, `Destructible` component).
- `b032b3b` FEAT attack telegraphs (`TelegraphManager`; dash/charge/slam windups).
- `a76fcf4` FEAT elite affixes + floating elite HP bars (`src/data/Affixes.ts`,
  `EliteAffixVisualManager`). NOTE: this commit also swept in unrelated accessibility
  files via `git add -A` — see CHORE-3.
- `522d188` FEAT Limit Break overflow upgrades (`src/data/LimitBreakUpgrades.ts`).
- `2ebc173` FEAT floor consumables — bomb/freeze/vacuum/gold (`ConsumablePickupSystem`,
  `WeaponManager.detonateArea`).
- `4365943` Wire armor penetration + 3 movement stats (C9 armor, C10 accel/sprint/combat).
- `d768284` Wire explosionDamage + duration stats into weapon scaling (C7, C8).
- `0bcbbdc` Fix pause-menu pill corners bleeding past rounded border.
- `0c7381b` Fix auto-upgrade: load persisted enable flag on fresh runs.
- `43c43e0` Perf/correctness batch: pool HUD payload, cache meta, split aura draw, etc.
- `3db4e75` Wire dead weapon stats + perf/correctness cleanup (prior session, unmerged).

- [x] **REFACTOR-2 (phase 1) — extract regular-enemy AI handlers** (done — `ee33c19`)
  Moved all 20 regular AI handlers (types 0–17) out of `EnemyAISystem.ts` (2,098 → 1,038
  lines) into one module per handler under `src/ecs/systems/enemy-ai/` (splitter.ts holds
  splitter + splitterMini). New `enemy-ai/common.ts` carries the cross-boundary
  scaffolding: PI constants, mutable `telegraphManager` + setter (re-exported so
  GameScene's import is unchanged), `aiWorld`/`setAIWorld`/`isDestructible`. Dispatcher
  switch, LOD throttling, elite auras, and miniboss/boss handlers untouched (phases 2–3
  filed). Every moved body verified byte-identical against the pre-move git blob by an
  independent transcription diff; public API surface unchanged (barrel re-exports).
  Suite could not run in the remote sandbox — verification was typecheck fingerprint +
  the transcription diff. Follow-up phases must import `telegraphManager` as a live
  binding, never copy it to a local.
