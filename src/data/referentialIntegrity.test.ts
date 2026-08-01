import { describe, test, expect, vi } from 'vitest';

// Upgrades.ts imports WeaponManager from '../weapons' (Phaser-coupled) purely
// for a type, and reads codex discovery state for new-weapon offer weighting.
// Stub both module boundaries so the catalogs load in the Node test env — the
// documented pattern (vitest.config.ts) for exercising Phaser-coupled code.
vi.mock('../weapons', () => ({ WeaponManager: class {} }));
vi.mock('../codex', () => ({
  getCodexManager: () => ({ getWeaponEntry: () => undefined }),
}));

import { ICON_MAP, isValidFrameName } from '../utils/IconMap';
import { RELICS, BOSS_TROPHIES, BOSS_TROPHY_RELICS } from './Relics';
import { SHIP_CHARACTERS } from './ShipCharacters';
import { STAGES } from './Stages';
import { SHIP_MOD_TRACKS } from './ShipMods';
import { ALL_BOOST_CARDS } from './BoostCards';
import { ALL_CARDS } from './Cards';
import { PERMANENT_UPGRADES, UPGRADE_CATEGORIES } from './PermanentUpgrades';
import { createUpgrades, UNLOCKABLE_WEAPONS } from './Upgrades';
import { createLimitBreakUpgrades } from './LimitBreakUpgrades';
import { ACHIEVEMENTS, BOSS_KILL_TRACKING, SHIP_WIN_TRACKING, STAGE_WIN_TRACKING } from '../achievements/AchievementDefinitions';
import { MILESTONES } from '../achievements/MilestoneDefinitions';
import { ENEMY_TYPES, EnemyCategory } from '../enemies/EnemyTypes';
import { BLESSINGS } from './Blessings';
import { TRAVERSAL_ABILITIES, VAULT_GUARD_PACKS } from './TraversalAbilities';
import { AMBUSH_NEST_WAVES } from './PoiCatalog';
import {
  EXPEDITION_QUESTS, EXPEDITION_QUEST_KEY_ORDER, getQuestForKeyId,
} from './ExpeditionQuests';
import { LORE_FRAGMENTS } from './LoreFragments';

/**
 * Referential-integrity sweep: every cross-reference key in the data catalogs
 * must resolve. Dangling references don't fail at build time — they fall back
 * (or crash) at the moment a player happens to touch the item. The Thorned
 * Mail relic shipped pointing at icon key 'thorn' (map has 'thorns') and only
 * surfaced in a field crash report's warning log; this sweep makes that class
 * of drift a red build instead.
 */

type IconRef = { source: string; id: string; icon: string };

function collectIconRefs(): IconRef[] {
  const refs: IconRef[] = [];
  const push = (source: string, items: readonly { id: string; icon: string }[]) => {
    for (const item of items) refs.push({ source, id: item.id, icon: item.icon });
  };

  push('Relics', RELICS);
  push('BossTrophies', BOSS_TROPHY_RELICS);
  push('BoostCards', ALL_BOOST_CARDS);
  push('Cards', ALL_CARDS);
  push('PermanentUpgrades', PERMANENT_UPGRADES);
  push('UpgradeCategories', UPGRADE_CATEGORIES);
  push('Upgrades', createUpgrades());
  push('LimitBreakUpgrades', createLimitBreakUpgrades());
  push('UnlockableWeapons', UNLOCKABLE_WEAPONS);
  push('Achievements', ACHIEVEMENTS);
  push('Milestones', MILESTONES);
  push('Blessings', BLESSINGS);
  push('TraversalAbilities', TRAVERSAL_ABILITIES);
  push('ExpeditionQuests', EXPEDITION_QUESTS);
  push('LoreFragments', LORE_FRAGMENTS);

  for (const [shipId, tracks] of Object.entries(SHIP_MOD_TRACKS)) {
    push(`ShipMods:${shipId}`, tracks);
  }

  return refs;
}

describe('data catalog referential integrity', () => {
  test('every icon key in every catalog resolves without fallback', () => {
    const refs = collectIconRefs();
    // Sanity: the sweep actually covers the catalogs — a refactor that empties
    // this list must fail loudly, not silently pass.
    expect(refs.length).toBeGreaterThan(100);

    const dangling = refs.filter(
      ({ icon }) => !(icon in ICON_MAP) && !isValidFrameName(icon),
    );

    expect(
      dangling,
      `Dangling icon keys (add to ICON_MAP or fix the reference): ${dangling
        .map((r) => `${r.source}/${r.id} → "${r.icon}"`)
        .join(', ')}`,
    ).toEqual([]);
  });

  test('every ship mod track id is unique within its ship', () => {
    for (const [shipId, tracks] of Object.entries(SHIP_MOD_TRACKS)) {
      const ids = tracks.map((t) => t.id);
      expect(new Set(ids).size, `duplicate track ids on ${shipId}`).toBe(ids.length);
    }
  });

  test('every boss-kill tracking key is a real enemy type with exactly one achievement', () => {
    for (const [enemyTypeId, trackingType] of Object.entries(BOSS_KILL_TRACKING)) {
      expect(ENEMY_TYPES[enemyTypeId], `unknown enemy type id "${enemyTypeId}"`).toBeDefined();
      const matches = ACHIEVEMENTS.filter((a) => a.trackingType === trackingType);
      expect(matches.map((a) => a.id), `"${trackingType}" must map to exactly 1 achievement`).toHaveLength(1);
    }
  });

  test('every boss has exactly one trophy relic and the name matches its enemy definition', () => {
    const bossIds = Object.values(ENEMY_TYPES)
      .filter((enemy) => enemy.category === EnemyCategory.Boss)
      .map((enemy) => enemy.id);

    expect(BOSS_TROPHIES.length, 'one trophy per boss').toBe(bossIds.length);

    for (const bossId of bossIds) {
      const matches = BOSS_TROPHIES.filter((trophy) => trophy.bossEnemyTypeId === bossId);
      expect(matches.map((t) => t.relic.id), `boss "${bossId}" needs exactly 1 trophy`).toHaveLength(1);
      expect(matches[0].bossName, `trophy bossName drifted from ENEMY_TYPES["${bossId}"].name`)
        .toBe(ENEMY_TYPES[bossId].name);
    }
  });

  test('trophy relics are disjoint from the base drop pool', () => {
    const baseIds = new Set(RELICS.map((relic) => relic.id));
    const leaked = BOSS_TROPHY_RELICS.filter((relic) => baseIds.has(relic.id));
    expect(leaked.map((r) => r.id), 'a trophy in RELICS would drop before it is earned').toEqual([]);

    const trophyIds = BOSS_TROPHY_RELICS.map((relic) => relic.id);
    expect(new Set(trophyIds).size, 'duplicate trophy relic ids').toBe(trophyIds.length);
  });

  test('every ship-win tracking key is a real ship id with exactly one achievement', () => {
    const shipIds = new Set(SHIP_CHARACTERS.map((s) => s.id));
    for (const [shipId, trackingType] of Object.entries(SHIP_WIN_TRACKING)) {
      expect(shipIds.has(shipId), `unknown ship id "${shipId}"`).toBe(true);
      const matches = ACHIEVEMENTS.filter((a) => a.trackingType === trackingType);
      expect(matches.map((a) => a.id), `"${trackingType}" must map to exactly 1 achievement`).toHaveLength(1);
    }
    expect(Object.keys(SHIP_WIN_TRACKING).length, 'every ship needs a win-tracking entry').toBe(shipIds.size);
  });

  test('every stage-win tracking key is a real stage id with exactly one achievement', () => {
    const stageIds = new Set(STAGES.map((s) => s.id));
    for (const [stageId, trackingType] of Object.entries(STAGE_WIN_TRACKING)) {
      expect(stageIds.has(stageId), `unknown stage id "${stageId}"`).toBe(true);
      const matches = ACHIEVEMENTS.filter((a) => a.trackingType === trackingType);
      expect(matches.map((a) => a.id), `"${trackingType}" must map to exactly 1 achievement`).toHaveLength(1);
    }
    expect(Object.keys(STAGE_WIN_TRACKING).length, 'every stage needs a win-tracking entry').toBe(stageIds.size);
  });

  test('achievement ids are unique and every nextTierId resolves', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size, 'duplicate achievement ids').toBe(ids.length);

    const dangling = ACHIEVEMENTS.filter((a) => a.nextTierId && !ids.includes(a.nextTierId));
    expect(
      dangling.map((a) => `${a.id} → "${a.nextTierId}"`),
      'nextTierId points at no achievement',
    ).toEqual([]);
  });

  test('every traversal ability resolves its synergy upgrade and owns a distinct barrier', () => {
    const upgradeIds = new Set(PERMANENT_UPGRADES.map((upgrade) => upgrade.id));
    for (const ability of TRAVERSAL_ABILITIES) {
      if (ability.synergyUpgradeId === undefined) continue;
      expect(
        upgradeIds.has(ability.synergyUpgradeId),
        `${ability.id} points at unknown upgrade "${ability.synergyUpgradeId}"`,
      ).toBe(true);
    }

    const abilityIds = TRAVERSAL_ABILITIES.map((ability) => ability.id);
    expect(new Set(abilityIds).size, 'duplicate ability id shifts every vault depth').toBe(
      abilityIds.length,
    );

    const barrierIds = TRAVERSAL_ABILITIES.map((ability) => ability.barrierTypeId);
    expect(new Set(barrierIds).size, 'two abilities claiming one barrier type').toBe(
      barrierIds.length,
    );
  });

  test('every vault guard pack resolves and is never boss-tier', () => {
    for (const ability of TRAVERSAL_ABILITIES) {
      const pack = VAULT_GUARD_PACKS[ability.guardTier];
      expect(pack.length).toBeGreaterThan(0);
      for (const member of pack) {
        const enemyType = ENEMY_TYPES[member.typeId];
        expect(enemyType, `${ability.id} guard ${member.typeId}`).toBeDefined();
        expect(member.count).toBeGreaterThan(0);
        // xpValue >= 1000 runs handleEnemyDeath's victory path, which would end the run
        // from a side room the moment the pack died.
        expect(enemyType.xpValue).toBeLessThan(1000);
      }
    }
  });

  test('every ambush nest wave resolves and is never boss-tier', () => {
    for (const [tier, pack] of Object.entries(AMBUSH_NEST_WAVES)) {
      expect(pack.length, `${tier} wave is empty`).toBeGreaterThan(0);
      for (const member of pack) {
        const enemyType = ENEMY_TYPES[member.typeId];
        expect(enemyType, `${tier} wave member ${member.typeId}`).toBeDefined();
        expect(member.count).toBeGreaterThan(0);
        expect(enemyType.xpValue).toBeLessThan(1000);
      }
    }
  });
});

describe('expedition quest data rules', () => {
  const byId = new Map(EXPEDITION_QUESTS.map((quest) => [quest.id, quest]));
  const STAGE_IDS = new Set(STAGES.map((stage) => stage.id));

  test('quest ids are unique and prefixed, and every quest has at least one step', () => {
    expect(byId.size).toBe(EXPEDITION_QUESTS.length);
    for (const quest of EXPEDITION_QUESTS) {
      expect(quest.id.startsWith('quest_'), quest.id).toBe(true);
      expect(quest.steps.length, quest.id).toBeGreaterThan(0);
    }
  });

  test('step ids are globally unique and follow the q_<quest>.sN form', () => {
    const stepIds = EXPEDITION_QUESTS.flatMap((quest) => quest.steps.map((step) => step.id));
    expect(new Set(stepIds).size).toBe(stepIds.length);
    for (const stepId of stepIds) expect(stepId, stepId).toMatch(/^q_[a-z0-9_]+\.s\d+$/);
  });

  test('nextQuestId resolves, is never a chain head twice, and chains are acyclic and at most 3 long', () => {
    const successorCounts = new Map<string, number>();
    for (const quest of EXPEDITION_QUESTS) {
      if (quest.nextQuestId === undefined) continue;
      expect(byId.has(quest.nextQuestId), quest.nextQuestId).toBe(true);
      successorCounts.set(quest.nextQuestId, (successorCounts.get(quest.nextQuestId) ?? 0) + 1);
    }
    for (const [questId, count] of successorCounts) expect(count, questId).toBe(1);

    for (const quest of EXPEDITION_QUESTS) {
      const walked = new Set<string>([quest.id]);
      let cursor = quest.nextQuestId;
      while (cursor !== undefined) {
        expect(walked.has(cursor), `cycle at ${cursor}`).toBe(false);
        walked.add(cursor);
        cursor = byId.get(cursor)?.nextQuestId;
      }
      expect(walked.size, quest.id).toBeLessThanOrEqual(3);
    }
  });

  // Doc 04 section 4's anti-chore rule: a 'run'-scope step must be completable inside one
  // expedition, so its target is bounded. A 'persistent' step accumulates across runs and is
  // deliberately not.
  const expectSectorTagResolves = (tag: string, stepId: string): void => {
    if (tag === 'boss-arena') return;
    expect(STAGE_IDS.has(tag.slice('biome:'.length)), stepId).toBe(true);
  };

  test('every run-scope target is reachable in one expedition and rewards are positive', () => {
    for (const quest of EXPEDITION_QUESTS) {
      for (const step of quest.steps) {
        expect(step.target, step.id).toBeGreaterThan(0);
        expect(step.goldReward, step.id).toBeGreaterThan(0);
        if (step.trigger.kind === 'reachDepth') {
          expect(step.target, step.id).toBeLessThanOrEqual(8);
        }
        if (step.trigger.kind === 'reachSector') {
          // The fold counts DISTINCT sectors, so a target above 1 is authorable. It is bounded
          // by what one expedition can reach at the live seed (16 sectors owning no ability and
          // no quest key, measured 2026-08-01) and must be 'run'-scope: a persisted visited set
          // holds sector keys a regenerated world would reuse for different rooms.
          expect(step.target, step.id).toBeLessThanOrEqual(12);
          if (step.target > 1) expect(step.scope, step.id).toBe('run');
          if (step.trigger.sectorTag !== undefined) {
            expectSectorTagResolves(step.trigger.sectorTag, step.id);
          }
        }
        if (step.trigger.kind === 'surviveInSector') {
          // The target IS the dwell in seconds, and doc 04's anti-chore rule bounds a survive
          // timer: a hold longer than this is a wait, not an objective.
          expect(step.target, step.id).toBeLessThanOrEqual(180);
          expectSectorTagResolves(step.trigger.sectorTag, step.id);
        }
        if (step.scope !== 'run') continue;
        if (step.trigger.kind === 'kill') expect(step.target, step.id).toBeLessThanOrEqual(800);
        if (step.trigger.kind === 'openGate') expect(step.target, step.id).toBeLessThanOrEqual(4);
        if (step.trigger.kind === 'findSecret') expect(step.target, step.id).toBeLessThanOrEqual(3);
      }
      expect(quest.completionGoldReward, quest.id).toBeGreaterThan(0);
    }
  });

  test('grants each quest key from exactly one quest and lists them in EXPEDITION_QUEST_KEY_ORDER', () => {
    const granted = EXPEDITION_QUESTS
      .map((quest) => quest.grantsKeyId)
      .filter((keyId): keyId is string => keyId !== undefined);
    expect(new Set(granted).size).toBe(granted.length);
    expect([...EXPEDITION_QUEST_KEY_ORDER]).toEqual(granted);
    for (const keyId of granted) {
      expect(getQuestForKeyId(keyId)?.grantsKeyId).toBe(keyId);
    }
  });
});
