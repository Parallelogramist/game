# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backlog & Task Tracking

`BACKLOG.md` (repo root) is the single source of truth for deferred work, known
issues, and improvement ideas. **At the start of a session, read it** and propose
which items to tackle. When you finish work, move the item to `BACKLOG-archive.md`
with the commit hash; when you discover new follow-ups or cuts, append them
immediately so nothing lives only in conversation. The human drives prioritization.

## Build & Development Commands

See `package.json` scripts (dev/build/preview/test).

No lint command configured. Tests use **Vitest** (`vitest.config.ts`, Node env): 167 files,
~1,978 tests, ~35s wall time. Pure logic is tested by mocking the Phaser/storage module
boundary; Phaser-coupled code is verified by play, not by mocking a live scene. Add tests
only where they genuinely pin logic (the workspace "Tests & comments" rule wins over any
test-first habit); keep the suite green.

## Deployment

GitHub Pages auto-deploys on push to `master`; see `.github/workflows/deploy.yml`.

**Pushing is a human gate.** This repo is public and a push to `master` deploys
game.parallelogramist.com, so agents never `git push` and never add remotes, no matter
what workspace-level policy says about pushing private repos. See `BACKLOG.md`
`## Human gates`.

**Architecture Overview** → `references/architecture-overview.md` — full ECS/Phaser architecture: components & systems, scene flow, weapons, enemies, visual/audio/effects, meta-progression, and all in-run systems.

**Expedition (the default run mode since 2026-07-31):** design authority is
`references/map/README.md` (its section 3 contracts win on conflict). Pure world math
lives in `src/world/` (never imports Phaser, `src/game/`, `src/systems/` or the ECS),
run/profile state in `src/expedition/`, mode adapters in `src/game/world/`.

## Tooling

Icon atlas scripts live in `tools/` (SVG sources: game-icons.net).

## Development Guidelines

**Parallel code path consistency:** New code paths achieving similar outcomes to existing ones must handle same cleanup, state changes, side effects. Review existing paths first. Bugs arise when new paths miss steps.

**System state reset:** Every system with module-level state needs `reset*System()` called in GameScene `create()`. Stale state carries over between runs otherwise.

**Scene shutdown listener:** Register `this.events.once('shutdown', this.shutdown, this)` in `create()`. Phaser won't auto-call shutdown on restart → listener accumulation + memory leaks.

**Sprite registration pairs:** Always `registerSprite(entityId, sprite)` on create, `unregisterSprite(entityId)` on remove. ECS-Phaser bridge must stay synced.

**Query once per frame:** `updateFrameCache()` once at update start, then `getEnemyIds()`/`getNearestEnemy()`. Per-system queries cause excess allocations.

**Object pooling:** Pre-allocate pools for frequent objects (damage numbers, projectiles, trails). Create/destroy with 100+ enemies causes GC stalls.

**Delta time conversion:** Phaser delta in ms. `delta * 0.001` for seconds.

**Entity removal order:** Destroy sprite + `unregisterSprite()` BEFORE `removeEntity()`. Entity-first orphans sprite.

**Tween cleanup:** `this.tweens.killAll()` in shutdown. Tweens run after scene restart otherwise.

**Encrypted storage:** All persistent data must use `SecureStorage` from `/src/storage/`, not raw `localStorage`.

**Visible or feel changes:** file a `POLISH-*` item under BACKLOG `## Human gates` for
operator playtest instead of retuning blind. New weapons and enemies must handle walls:
see `src/world/weaponWallBehavior.ts` and `src/world/staticCollision.ts`.