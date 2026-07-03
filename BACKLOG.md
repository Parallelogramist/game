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

## Next

(empty — next agent: take the topmost Later item)

## Later

- [ ] **BUG-FREEZE-VERIFY — confirm the reported game freeze is fixed** · area: stability
  **Context:** user reported the game "sometimes just freezes up." No error handling
  existed anywhere, so any uncaught exception during a Phaser scene update() silently
  halted the game with zero diagnostics — Phaser only reschedules its next
  `requestAnimationFrame` after a step completes without throwing. Two fixes landed
  without a live repro (network sandboxed, couldn't run a browser): (1) the 100-kill
  "annihilation" combo pulse (`GameScene.ts`, `handleComboThreshold`) iterated
  bitECS's LIVE enemy query array while calling `handleEnemyDeath` — which removes
  the dying entity and, for Splitter enemies, synchronously spawns 2 new ones via
  `handleSplit`/`addEntity` — mutating the very array being iterated; now snapshotted
  first, matching the safe pattern already used by StatusEffectSystem/
  HazardZoneSystem for this exact hazard. (2) The new boss-intro letterbox
  (session's polish drop) had a tween whose target was a plain proxy object
  (`ruleState`), not the `rules` Graphics object in the cleanup array — if the
  player died within ~180-480ms of a boss spawning, `cleanupBossIntro()` destroyed
  `rules` but the orphaned tween kept calling `.clear()/.fillStyle()/.fillRect()` on
  it every frame for the rest of its run. Also added a global `window.error`/
  `unhandledrejection` handler (`main.ts`) + `#crash-overlay` (`index.html`) so ANY
  future uncaught exception surfaces a "tap to reload" recovery screen instead of a
  silent frozen frame — this alone should turn future rare freezes into diagnosable,
  reportable events (check the console) rather than mystery hangs. **Needs a human
  session or two of normal play (ideally including a 100+ kill combo chain and a
  death timed near a boss spawn) to confirm the freeze doesn't recur; if it does,
  the crash overlay should now at least surface something in the console to
  triage from.**

- [ ] **POLISH-UI-CAMERA — exclude UI from postFX pipelines and camera flash/fade**
  · area: visual · **Why:** HUD/minimap/overlays render through `cameras.main`, so
  BloomPipeline blooms bright HUD pixels, DistortionPipeline shockwaves warp HUD
  text they cross, and `camera.flash`/`fadeOut` composite over UI. Depth-band fixes
  (see DepthLayers header) removed the overlay-class artifacts; the remaining fix
  is a dedicated UI camera (`cameras.add` + per-camera `ignore` lists on every UI
  container vs world object) — invasive, needs runtime verification of input
  hit-testing and both scale-mode paths before landing. Audited 2026-07-02.

- [ ] **POLISH-CANVAS-DPR — render the canvas at device resolution on phones**
  · area: visual/mobile · **BLOCKED on on-device verification — do not land blind**
  **Why:** Phaser sizes the canvas backing store in CSS pixels, so a 3× iPhone
  renders at 1/3 physical resolution and upscales (soft edges on the neon lines).
  Candidate: EXPAND mode + `zoom: 1/Math.min(devicePixelRatio, 2)` (or manual canvas
  resize on the ScaleManager resize event) — but EXPAND×zoom interaction is
  undocumented and input-coordinate mapping + HUD density compensation
  (`HudScale.densityCompensation`) both depend on the resulting game-unit size.
  Needs a real iPhone/iPad to validate before landing.

- [ ] **REFACTOR-2 (phase 2) — extract miniboss AI handlers** · area: architecture
  **Value:** phase 1 (done — `ee33c19`) moved the 20 regular handlers into
  `src/ecs/systems/enemy-ai/`; EnemyAISystem.ts is now 1,038 lines. Next: the miniboss
  handlers (Glutton, SwarmMother, Charger, Necromancer, TwinA/TwinB) move the same way —
  verbatim bodies, shared scaffolding via `enemy-ai/common.ts` (note: handler modules
  must read `telegraphManager` via live ES-module import binding, never copy to a local).
  Behavior-identical; verify with the byte-identity diff vs the pre-move blob + suite
  green (suite runnable only outside the remote sandbox).

- [ ] **REFACTOR-2 (phase 3) — extract boss AI handlers + dispatcher slim-down** · area:
  architecture. HordeKing, VoidWyrm, TheMachine handlers plus `applyEliteAuras` and the
  boss-phase tracking move out after phase 2; EnemyAISystem.ts ends as dispatcher + LOD
  only. Same verification regime as phase 2.

- [ ] **POLISH-ACCOUNT-GATE-TOAST — unlock feedback when an account: ship gate opens**
  · area: ux · **Value:** hidden-gated ships toast on unlock via HiddenUnlockManager;
  an `account:<n>` gate (`src/data/UnlockGates.ts`, wired `a41c64e`) crosses its
  threshold silently mid-shop-purchase — the player never learns a ship appeared.
  **Do only once a ship actually uses `account:`** (none does today; roster gating is
  a human balance call). Hook: ShopScene purchase path already reads
  `getAccountLevel()`; compare before/after against `SHIP_CHARACTERS` account gates,
  toast via ToastManager. Tiny session.

- [ ] **BALANCE-EXPLODER-FUSE — telegraphed fuse for the Exploder death explosion**
  · area: readability/balance · **BLOCKED on human sign-off — behavior change**
  **Why parked:** FEAT-TELEGRAPH-COVERAGE (`4f18ac4`) covered every *windup-based* heavy
  hit, but the Exploder explodes instantly on death (`GameScene.handleEnemyDeath` →
  `handleExplosion(x, y, 60, 20)`, same frame) — there is no windup to telegraph. Warning
  the player requires adding a fuse delay (e.g. 0.4s armed state before detonation),
  which changes combat timing and Exploder lethality. Same question applies to VOLATILE
  affix detonations (`drainVolatileExplosions`, radius 95). If approved: fuse state in
  `handleEnemyDeath`, ring spec in `src/ecs/systems/enemy-ai/telegraphs.ts`, test-first.

**Parked — bigger than one fleet session; needs its own plan cycle + human kickoff:**

- [ ] **REFACTOR-1 — split the GameScene god object** · area: architecture
  Now **7,648 lines**. Extract cohesive managers
  (run/meta-bonus application, pickup + level-up flow, spawn-director glue, HUD payload);
  `resetAllRunSystems()` is the model. Multi-session; each extraction its own commit.
- [ ] **FEAT-RUNNER-MODE — new endless-runner game mode** · area: gameplay
  Designed (Area C of `docs/superpowers/specs/2026-05-29-scroll-runner-polish-design.md`)
  but a full new scene (forced auto-scroll `RunnerScene` reusing enemies/weapons/HUD).
  Needs its own brainstorm → plan cycle.

---

## Human gates

Never agent work. The fleet must not do any of these.

- **Push / deploy:** the repo has `origin` and **a push to `master` auto-deploys GitHub
  Pages** (`.github/workflows/deploy.yml`). Pushing is an explicit human action — agents
  never `git push` or add remotes. Publishing/store submission likewise.
- **Playtest queue** (code complete; needs a human in a browser — agents must not retune
  blind):
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
  - **POLISH-MENU-NAV** — keyboard/gamepad nav on the newly wired scenes (`abf7c58`).
    Check with a controller: (a) PactSelect — yellow focus ring vs pact-color selected
    border legibility; B = skip-pacts-and-begin feels right (it's not "back"), (b)
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

---

## Done

(Recent; full per-item write-ups and the complete pre-2026-06-09 changelog live in
**`BACKLOG-archive.md`**.)

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
