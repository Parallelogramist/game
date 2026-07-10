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

### Proposed (auto)

- [ ] **FEAT-WEAPON-SINGULARITY** — 17th weapon: gravity-well projectile that
  PULLS enemies together. Value: 16 weapons now cover projectile / orbit /
  beam / return / deploy, but none *reposition* enemies — the only crowd-
  control lever is the `void` hazard zone, never a player weapon. A lobbed
  singularity that yanks nearby enemies toward a point (then collapses for a
  burst) adds a genuinely new archetype — enemy-clumping that turns every
  AOE weapon's value up and rewards combo builds. Pure pull/collapse timing
  math unit-testable like `sentryLogic.ts` (no per-enemy Phaser needed);
  reuse the SpatialHash for the pull query, cap displacement per frame so it
  reads as a tug not a teleport. Mastery: leaves a lingering slow field;
  evolution candidate: black hole (larger radius + damage-over-duration).
  Same full mirror-list sync as Sentry (registry / UNLOCKABLE_WEAPONS /
  WeaponEvolutions / WeaponSynergies / mastery category / IconMap + the three
  content-integrity test arrays).

## Later

- [ ] **POLISH-GLYPH-SWEEP-2** — finish the non-HUD glyph sweep. Value: the
  2026-07-04 HUD skin pass (drawn pause/dash/ult/fullscreen icons, DISPLAY_FONT
  typography, kills/gold stack, mastery star badge) removed every rendered emoji
  from in-run surfaces, but left two typographic text glyphs by choice: the `✓`
  victory mark in the pause-menu run history (`PauseMenuManager.ts` ~1958) and
  `→` arrows in streak/evolve strings. If those ever render via a system
  fallback font on some platform, swap them for drawn ticks/labels. Also
  consider promoting the drawn four-point-star helper (duplicated in
  `HUDManager.ts` + `TouchActionButtons.ts`) into a shared visual util.

---

## Human gates

Never agent work. The fleet must not do any of these.

- **Push / deploy:** the repo has `origin` and **a push to `master` auto-deploys GitHub
  Pages** (`.github/workflows/deploy.yml`). Pushing is an explicit human action — agents
  never `git push` or add remotes. Publishing/store submission likewise.
- **Playtest queue** (code complete; needs a human in a browser — agents must not retune
  blind):
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

---

## Done

(Recent; full per-item write-ups and the complete pre-2026-06-09 changelog live in
**`BACKLOG-archive.md`**.)

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
