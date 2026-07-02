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

- [ ] **REFACTOR-2 (phase 1) — extract regular-enemy AI handlers** · area: architecture
  **Value:** `EnemyAISystem.ts` is 2,076 lines around one ~29-case switch;
  `src/ecs/systems/enemy-ai/` exists but holds only `state.ts` + `index.ts`. Extraction
  unlocks per-handler tests and shrinks the regression blast radius.
  **Plan (this session):** move the **regular** AI handlers (types 0–17) into one module
  per handler under `enemy-ai/`, keep the switch as a thin dispatcher. Mechanical,
  behavior-identical; `tsc` + `vite build` clean; suite green. File phase 2
  (minibosses 50–55) and phase 3 (bosses 100–102) when this lands.

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
