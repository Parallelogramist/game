# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backlog & Task Tracking

`BACKLOG.md` (repo root) is the single source of truth for deferred work, known
issues, and improvement ideas. **At the start of a session, read it** and propose
which items to tackle. When you finish work, move the item to `BACKLOG-archive.md`
with the commit hash; when you discover new follow-ups or cuts, append them
immediately so nothing lives only in conversation. The human drives prioritization.

## Build & Development Commands

- `npm run dev` - Start Vite dev server with hot reload
- `npm run build` - TypeScript check + production build
- `npm run preview` - Preview production build locally
- `npm run test` - Run the Vitest unit suite once (`test:watch` for watch mode)

No lint command configured. Tests use **Vitest** (`vitest.config.ts`, Node env). Coverage
is thin — pure logic only (e.g. ECS save/load serialization); Phaser-coupled code is
exercised by mocking its module boundary, not a live scene. Add a failing test first for
new logic where it can run without a real Phaser scene.

## Deployment

- **GitHub Pages**: Auto-deploys on push to `master` via `.github/workflows/deploy.yml` (Node 20)
- **Vite config**: Base path `/`, output to `dist/`

**Architecture Overview** → `references/architecture-overview.md` — full ECS/Phaser architecture: components & systems, scene flow, weapons, enemies, visual/audio/effects, meta-progression, and all in-run systems.

## Tooling

- `tools/build-icon-atlas.cjs` — Build icon spritesheet from SVGs in `tools/icon-sources/` (sharp)
- `tools/download-icons.sh` — Download icon SVGs from game-icons.net

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