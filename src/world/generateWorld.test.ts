import { describe, it, expect } from 'vitest';
import { STAGES, getStageById } from '../data/Stages';
import { EXPEDITION_QUESTS, EXPEDITION_QUEST_KEY_ORDER } from '../data/ExpeditionQuests';
import { generateWorld } from './generateWorld';
import {
  EDGE_DIRECTIONS,
  EdgeKind,
  PoiKind,
  SECTOR_TILE_COLS,
  SECTOR_TILE_COUNT,
  SECTOR_TILE_ROWS,
  TILE_SIZE,
  TileKind,
  WORLDGEN_VERSION,
  directionDelta,
  edgeIdFor,
  oppositeDirection,
  tileIndex,
  worldBoundsRect,
} from './worldTypes';
import type { EdgeDef, EdgeDirection, SectorDef, SectorKey, WorldGenInputs, WorldMap } from './worldTypes';
import { SECTOR_HEIGHT, SECTOR_WIDTH, sectorRectWorld } from './worldSpace';
import { secretShellRingIndices } from './sectorInterior';

const SEEDS = Array.from({ length: 100 }, (_, index) => index * 7919 + 12345);
const INPUTS: WorldGenInputs = {
  abilityGateOrder: ['blink_drive', 'breach_charges', 'magno_tether',
    'phase_cloak', 'thermal_ward', 'signal_decryptor'],
  availableBiomeIds: STAGES.map(stage => stage.id),
};
const WORLDS = SEEDS.map(seed => generateWorld(seed, INPUTS));

function neighbourKeyOf(sector: SectorDef, direction: EdgeDirection): SectorKey {
  const { dsx, dsy } = directionDelta(direction);
  return `${sector.sx + dsx},${sector.sy + dsy}`;
}

function canTraverse(
  edge: EdgeDef, direction: EdgeDirection, abilities: Set<string>, breakablesPassable: boolean
): boolean {
  switch (edge.kind) {
    case EdgeKind.Open: return true;
    case EdgeKind.Breakable: return breakablesPassable;
    case EdgeKind.OneWay: return edge.passDirection === direction;
    case EdgeKind.AbilityDoor:
      return edge.requiredId !== undefined && abilities.has(edge.requiredId);
    default: return false;
  }
}

function collectAbilities(sector: SectorDef, abilities: Set<string>): boolean {
  let gained = false;
  for (const slot of sector.poiSlots) {
    if (slot.kind !== PoiKind.AbilityPowerUp || slot.grantsAbilityId === undefined) continue;
    if (abilities.has(slot.grantsAbilityId)) continue;
    abilities.add(slot.grantsAbilityId);
    gained = true;
  }
  return gained;
}

/** One expansion round: cross every currently-traversable edge once and bank
 *  whatever abilities the newly entered sectors hand out. */
function expandOnce(
  map: WorldMap, reached: Set<SectorKey>, abilities: Set<string>, breakablesPassable: boolean
): boolean {
  let grew = false;
  for (const key of [...reached]) {
    const sector = map.sectors.get(key)!;
    for (const direction of EDGE_DIRECTIONS) {
      if (!canTraverse(sector.edges[direction], direction, abilities, breakablesPassable)) continue;
      const neighbourKey = neighbourKeyOf(sector, direction);
      const neighbour = map.sectors.get(neighbourKey);
      if (!neighbour || reached.has(neighbourKey)) continue;
      reached.add(neighbourKey);
      grew = true;
      if (collectAbilities(neighbour, abilities)) grew = true;
    }
  }
  return grew;
}

function simulate(
  map: WorldMap, breakablesPassable: boolean
): { reached: Set<SectorKey>; abilities: Set<string> } {
  const reached = new Set<SectorKey>([map.startKey]);
  const abilities = new Set<string>();
  collectAbilities(map.sectors.get(map.startKey)!, abilities);
  while (expandOnce(map, reached, abilities, breakablesPassable)) { /* to fixpoint */ }
  return { reached, abilities };
}

/** Every sector from which the start sector is still reachable, honouring
 *  one-way pass directions and the abilities held right now. */
function sectorsThatCanReachStart(map: WorldMap, abilities: Set<string>): Set<SectorKey> {
  const canReach = new Set<SectorKey>([map.startKey]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, sector] of map.sectors) {
      if (canReach.has(key)) continue;
      for (const direction of EDGE_DIRECTIONS) {
        if (!canTraverse(sector.edges[direction], direction, abilities, true)) continue;
        if (!canReach.has(neighbourKeyOf(sector, direction))) continue;
        canReach.add(key);
        grew = true;
        break;
      }
    }
  }
  return canReach;
}

function apertureTile(
  direction: EdgeDirection, axisIndex: number, depth: number
): { tileX: number; tileY: number } {
  if (direction === 'north') return { tileX: axisIndex, tileY: depth };
  if (direction === 'south') return { tileX: axisIndex, tileY: SECTOR_TILE_ROWS - 1 - depth };
  if (direction === 'west') return { tileX: depth, tileY: axisIndex };
  return { tileX: SECTOR_TILE_COLS - 1 - depth, tileY: axisIndex };
}

function expectedMouthTile(kind: EdgeKind): TileKind {
  if (kind === EdgeKind.Open) return TileKind.Open;
  if (kind === EdgeKind.Breakable) return TileKind.Breakable;
  return TileKind.GateClosed;
}

function floodTiles(
  tiles: Uint8Array, seedX: number, seedY: number,
  breakablesPassable = false, gapsPassable = false
): Set<number> {
  const reached = new Set<number>();
  const seedIndex = tileIndex(seedX, seedY);
  const passable = (index: number) =>
    tiles[index] === TileKind.Open || tiles[index] === TileKind.HazardFloor
    || (breakablesPassable && tiles[index] === TileKind.Breakable)
    || (gapsPassable && tiles[index] === TileKind.VoidGap);
  if (!passable(seedIndex)) return reached;
  reached.add(seedIndex);
  const queue = [seedIndex];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const tileX = index % SECTOR_TILE_COLS;
    const tileY = Math.floor(index / SECTOR_TILE_COLS);
    const neighbours = [
      [tileX, tileY - 1], [tileX + 1, tileY], [tileX, tileY + 1], [tileX - 1, tileY],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || nx >= SECTOR_TILE_COLS || ny < 0 || ny >= SECTOR_TILE_ROWS) continue;
      const neighbourIndex = tileIndex(nx, ny);
      if (reached.has(neighbourIndex) || !passable(neighbourIndex)) continue;
      reached.add(neighbourIndex);
      queue.push(neighbourIndex);
    }
  }
  return reached;
}

function firstEntryTile(sector: SectorDef): { tileX: number; tileY: number } | undefined {
  for (const direction of EDGE_DIRECTIONS) {
    const entry = sector.entryTiles[direction];
    if (entry) return entry;
  }
  return undefined;
}

describe('invariant 0 — tile grid constants stay in lockstep with the sector size', () => {
  it('derives 32x18 tiles from the world-space sector', () => {
    expect(SECTOR_TILE_COLS).toBe(32);
    expect(SECTOR_TILE_ROWS).toBe(18);
    expect(SECTOR_TILE_COLS * TILE_SIZE).toBe(SECTOR_WIDTH);
    expect(SECTOR_TILE_ROWS * TILE_SIZE).toBe(SECTOR_HEIGHT);
    expect(SECTOR_TILE_COLS * SECTOR_TILE_ROWS).toBe(SECTOR_TILE_COUNT);
  });
});

describe('invariant 1 — determinism', () => {
  it('regenerates an identical world for every seed', () => {
    SEEDS.forEach((seed, index) => {
      expect(generateWorld(seed, INPUTS)).toEqual(WORLDS[index]);
    });
  }, 30_000);

  it('produces different worlds for different seeds', () => {
    expect(WORLDS[0]).not.toEqual(WORLDS[1]);
  });
});

describe('invariant 2 — edge reciprocity', () => {
  it('shares one edge object between both sides and walls off absent neighbours', () => {
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        for (const direction of EDGE_DIRECTIONS) {
          const neighbour = map.sectors.get(neighbourKeyOf(sector, direction));
          if (!neighbour) {
            expect(sector.edges[direction].kind).toBe(EdgeKind.Wall);
            continue;
          }
          expect(sector.edges[direction])
            .toBe(neighbour.edges[oppositeDirection(direction)]);
        }
      }
    }
  });
});

describe('invariant 3 — gate-order solvability', () => {
  it('reaches every sector, POI and gated ability in unlock order', () => {
    for (const map of WORLDS) {
      const { reached, abilities } = simulate(map, true);
      expect(reached.size).toBe(map.sectors.size);
      for (const sector of map.sectors.values()) {
        if (sector.poiSlots.length > 0) expect(reached.has(sector.key)).toBe(true);
      }
      for (const abilityId of map.abilityOrder) expect(abilities.has(abilityId)).toBe(true);
      expect(reached.has(map.bossArenaKey)).toBe(true);
    }
  });

  it('still reaches every ability and the boss with breakable plugs treated as walls', () => {
    for (const map of WORLDS) {
      const { reached, abilities } = simulate(map, false);
      for (const sector of map.sectors.values()) {
        const grantsAbility = sector.poiSlots.some(slot => slot.kind === PoiKind.AbilityPowerUp);
        if (grantsAbility) expect(reached.has(sector.key)).toBe(true);
      }
      for (const abilityId of map.abilityOrder) expect(abilities.has(abilityId)).toBe(true);
      expect(reached.has(map.bossArenaKey)).toBe(true);
    }
  });

  it('gates every ability the inputs ask for', () => {
    for (const map of WORLDS) {
      expect(map.abilityOrder).toEqual(INPUTS.abilityGateOrder);
    }
  });
});

describe('invariant 4 — no one-way soft-lock', () => {
  it('keeps the start sector reachable from everywhere at every expansion round', () => {
    for (const map of WORLDS) {
      const reached = new Set<SectorKey>([map.startKey]);
      const abilities = new Set<string>();
      collectAbilities(map.sectors.get(map.startKey)!, abilities);
      do {
        const canReturn = sectorsThatCanReachStart(map, abilities);
        for (const key of reached) expect(canReturn.has(key)).toBe(true);
      } while (expandOnce(map, reached, abilities, true));
    }
  });
});

describe('invariant 5 — interior connectivity', () => {
  it('connects every entry tile and POI tile once rubble and gaps can be crossed', () => {
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        const seed = firstEntryTile(sector);
        expect(seed).toBeDefined();
        const reached = floodTiles(sector.tiles, seed!.tileX, seed!.tileY, true, true);
        for (const direction of EDGE_DIRECTIONS) {
          const entry = sector.entryTiles[direction];
          if (entry) expect(reached.has(tileIndex(entry.tileX, entry.tileY))).toBe(true);
        }
        for (const slot of sector.poiSlots) {
          expect(reached.has(tileIndex(slot.tileX, slot.tileY))).toBe(true);
        }
      }
    }
  });

  // The only POI a wall may stand in front of is a sealed cache: a shell is the one pass that
  // puts breakable tiles between an entry tile and a slot, and it must never reach another.
  it('leaves only sealed and gapped caches unreachable on foot', () => {
    const behindAWall: string[] = [];
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        const seed = firstEntryTile(sector);
        const reached = floodTiles(sector.tiles, seed!.tileX, seed!.tileY);
        for (const direction of EDGE_DIRECTIONS) {
          const entry = sector.entryTiles[direction];
          if (entry) expect(reached.has(tileIndex(entry.tileX, entry.tileY))).toBe(true);
        }
        for (const slot of sector.poiSlots) {
          if (reached.has(tileIndex(slot.tileX, slot.tileY))) {
            expect(slot.sealed).not.toBe(true);
            expect(slot.gapped).not.toBe(true);
            continue;
          }
          if (slot.kind !== PoiKind.Secret
            || (slot.sealed !== true && slot.gapped !== true)) {
            behindAWall.push(`seed ${map.seed} sector ${sector.key} slot ${slot.id}`);
          }
        }
      }
    }
    expect(behindAWall).toEqual([]);
  });
});

describe('invariant 6 — aperture and POI clearance', () => {
  it('keeps every aperture mouth and approach in the shape its edge kind requires', () => {
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        for (const direction of EDGE_DIRECTIONS) {
          const edge = sector.edges[direction];
          if (edge.kind === EdgeKind.Wall) continue;
          for (let axis = edge.apertureStart; axis <= edge.apertureEnd; axis++) {
            for (const depth of [1, 2]) {
              const { tileX, tileY } = apertureTile(direction, axis, depth);
              expect(sector.tiles[tileIndex(tileX, tileY)]).toBe(TileKind.Open);
            }
            const mouth = apertureTile(direction, axis, 0);
            expect(sector.tiles[tileIndex(mouth.tileX, mouth.tileY)])
              .toBe(expectedMouthTile(edge.kind));
          }
        }
      }
    }
  });

  it('leaves no blocking tile around any POI or entry tile', () => {
    const isBlocking = (kind: number) =>
      kind === TileKind.Solid || kind === TileKind.Breakable
      || kind === TileKind.GateClosed || kind === TileKind.VoidGap;
    const violations: string[] = [];
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        const centres = [
          ...sector.poiSlots.map(slot => ({ tileX: slot.tileX, tileY: slot.tileY })),
          ...EDGE_DIRECTIONS.map(direction => sector.entryTiles[direction]).filter(Boolean),
        ] as { tileX: number; tileY: number }[];
        for (const centre of centres) {
          for (let tileY = Math.max(1, centre.tileY - 1);
            tileY <= Math.min(SECTOR_TILE_ROWS - 2, centre.tileY + 1); tileY++) {
            for (let tileX = Math.max(1, centre.tileX - 1);
              tileX <= Math.min(SECTOR_TILE_COLS - 2, centre.tileX + 1); tileX++) {
              if (!isBlocking(sector.tiles[tileIndex(tileX, tileY)])) continue;
              violations.push(`seed ${map.seed} sector ${sector.key} tile ${tileX},${tileY}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('gives the boss arena an open fighting floor', () => {
    for (const map of WORLDS) {
      const boss = map.sectors.get(map.bossArenaKey)!;
      const nonSolid = [...boss.tiles].filter(kind => kind !== TileKind.Solid).length;
      expect(nonSolid).toBeGreaterThanOrEqual(375);
    }
  });
});

describe('invariant 7 — danger ramp and resolvable biomes', () => {
  it('starts safe in the spine biome and never eases off going deeper', () => {
    for (const map of WORLDS) {
      const start = map.sectors.get(map.startKey)!;
      expect(start.danger).toBe(0);
      expect(start.biomeId).toBe('stage_deep_void');

      for (const sector of map.sectors.values()) {
        expect(sector.danger).toBeGreaterThanOrEqual(0);
        expect(sector.danger).toBeLessThanOrEqual(1);
        expect(getStageById(sector.biomeId)).toBeDefined();
        if (sector.key === map.startKey) continue;

        const parents = EDGE_DIRECTIONS
          .filter(direction => sector.edges[direction].kind !== EdgeKind.Wall)
          .map(direction => map.sectors.get(neighbourKeyOf(sector, direction)))
          .filter((neighbour): neighbour is SectorDef =>
            neighbour !== undefined && neighbour.depth === sector.depth - 1);
        expect(parents.length).toBeGreaterThan(0);
        for (const parent of parents) {
          expect(sector.danger).toBeGreaterThanOrEqual(parent.danger);
        }
      }
    }
  });
});

describe('invariant 8 — version stamp and budget', () => {
  it('stamps the generator version, seed, start key and sector count', () => {
    SEEDS.forEach((seed, index) => {
      const map = WORLDS[index];
      expect(map.worldGenVersion).toBe(WORLDGEN_VERSION);
      expect(map.seed).toBe(seed);
      expect(map.startKey).toBe('0,0');
      expect(map.sectors.size).toBe(48);
    });
  });
});

const QUEST_KEYS = [...EXPEDITION_QUEST_KEY_ORDER];
const QUEST_INPUTS: WorldGenInputs = { ...INPUTS, questKeyOrder: QUEST_KEYS };
const QUEST_WORLDS = SEEDS.map(seed => generateWorld(seed, QUEST_INPUTS));

const HIDDEN_COUNT = 3;
const HIDDEN_INPUTS: WorldGenInputs = { ...QUEST_INPUTS, hiddenSectorCount: HIDDEN_COUNT };
const HIDDEN_WORLDS = SEEDS.map(seed => generateWorld(seed, HIDDEN_INPUTS));

function hiddenKeysOf(map: WorldMap): SectorKey[] {
  return [...map.sectors.values()].filter(sector => sector.hidden === true)
    .map(sector => sector.key).sort();
}

function keyDoorEdgeIdsByRequiredId(map: WorldMap): Map<string, Set<string>> {
  const byRequiredId = new Map<string, Set<string>>();
  for (const sector of map.sectors.values()) {
    for (const direction of EDGE_DIRECTIONS) {
      const edge = sector.edges[direction];
      if (edge.kind !== EdgeKind.KeyDoor) continue;
      const requiredId = edge.requiredId ?? '';
      const edgeIds = byRequiredId.get(requiredId) ?? new Set<string>();
      edgeIds.add(edgeIdFor(sector.sx, sector.sy, direction));
      byRequiredId.set(requiredId, edgeIds);
    }
  }
  return byRequiredId;
}

const ALL_ABILITIES = new Set(INPUTS.abilityGateOrder);

/** Reachability with every ability held and breakables broken, so a quest door whose key is not
 *  in `heldKeyIds` is the only thing that can stop the walk. */
function reachableHoldingKeys(map: WorldMap, heldKeyIds: readonly string[]): Set<SectorKey> {
  const held = new Set(heldKeyIds);
  const reached = new Set<SectorKey>([map.startKey]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const key of [...reached]) {
      const sector = map.sectors.get(key)!;
      for (const direction of EDGE_DIRECTIONS) {
        const edge = sector.edges[direction];
        const passable = edge.kind === EdgeKind.KeyDoor
          ? edge.requiredId !== undefined && held.has(edge.requiredId)
          : canTraverse(edge, direction, ALL_ABILITIES, true);
        if (!passable) continue;
        const neighbourKey = neighbourKeyOf(sector, direction);
        if (!map.sectors.has(neighbourKey) || reached.has(neighbourKey)) continue;
        reached.add(neighbourKey);
        grew = true;
      }
    }
  }
  return reached;
}

/** The keys a player can earn without ever finding a secret. */
const KEYS_NEEDING_NO_SECRET = EXPEDITION_QUESTS
  .filter(quest => quest.grantsKeyId !== undefined
    && !quest.steps.some(step => step.trigger.kind === 'findSecret'))
  .map(quest => quest.grantsKeyId as string);

describe('invariant 9: quest key doors', () => {
  it('places every requested quest key exactly once', () => {
    for (const map of QUEST_WORLDS) {
      const byRequiredId = keyDoorEdgeIdsByRequiredId(map);
      expect([...byRequiredId.keys()].sort()).toEqual([...QUEST_KEYS].sort());
      for (const edgeIds of byRequiredId.values()) expect(edgeIds.size).toBe(1);
    }
  });

  it('leaves the boss and every ability reachable with no quest key held', () => {
    for (const map of QUEST_WORLDS) {
      const { reached, abilities } = simulate(map, true);
      for (const sector of map.sectors.values()) {
        const grantsAbility = sector.poiSlots.some(slot => slot.grantsAbilityId !== undefined);
        if (grantsAbility) expect(reached.has(sector.key)).toBe(true);
      }
      for (const abilityId of map.abilityOrder) expect(abilities.has(abilityId)).toBe(true);
      expect(reached.has(map.bossArenaKey)).toBe(true);
    }
  });

  it('adds quest doors without moving anything else in the layout', () => {
    WORLDS.forEach((plain, index) => {
      const quest = QUEST_WORLDS[index];
      expect([...quest.sectors.keys()]).toEqual([...plain.sectors.keys()]);
      expect(quest.abilityOrder).toEqual(plain.abilityOrder);
      expect(quest.bossArenaKey).toBe(plain.bossArenaKey);

      for (const [key, questSector] of quest.sectors) {
        const plainSector = plain.sectors.get(key)!;
        expect(questSector.poiSlots).toEqual(plainSector.poiSlots);
        expect(questSector.breakables).toEqual(plainSector.breakables);
        expect(questSector.entryTiles).toEqual(plainSector.entryTiles);
        expect(questSector.depth).toBe(plainSector.depth);
        expect(questSector.danger).toBe(plainSector.danger);
        expect(questSector.biomeId).toBe(plainSector.biomeId);

        for (const direction of EDGE_DIRECTIONS) {
          const questEdge = questSector.edges[direction];
          const plainEdge = plainSector.edges[direction];
          if (questEdge.kind !== EdgeKind.KeyDoor) {
            expect(questEdge.kind).toBe(plainEdge.kind);
          } else {
            expect(plainEdge.kind).toBe(EdgeKind.Open);
          }
          expect(questEdge.apertureStart).toBe(plainEdge.apertureStart);
          expect(questEdge.apertureEnd).toBe(plainEdge.apertureEnd);
        }
      }
    });
  });

  it('never seals every hidden sector behind a key only a secret hunt pays for', () => {
    for (const map of HIDDEN_WORLDS) {
      const reached = reachableHoldingKeys(map, KEYS_NEEDING_NO_SECRET);
      const reachableHidden = [...map.sectors.values()]
        .filter(sector => sector.hidden === true && reached.has(sector.key));
      expect(reachableHidden.length).toBeGreaterThan(0);
    }
  });
});

describe('invariant 10: hidden sectors', () => {
  it('conceals exactly the requested count, each a dead end behind a breakable wall', () => {
    for (const map of HIDDEN_WORLDS) {
      const hiddenKeys = hiddenKeysOf(map);
      expect(hiddenKeys.length).toBe(HIDDEN_COUNT);
      for (const key of hiddenKeys) {
        const sector = map.sectors.get(key)!;
        expect(key).not.toBe(map.startKey);
        expect(key).not.toBe(map.bossArenaKey);
        expect(sector.poiSlots.some(slot => slot.kind === PoiKind.AbilityPowerUp)).toBe(false);
        const ways = EDGE_DIRECTIONS.filter(
          direction => sector.edges[direction].kind !== EdgeKind.Wall);
        expect(ways.length).toBe(1);
        expect(sector.edges[ways[0]].kind).toBe(EdgeKind.Breakable);
        // Never a concealed room behind another concealed room.
        const neighbourKey = neighbourKeyOf(sector, ways[0]);
        expect(map.sectors.get(neighbourKey)!.hidden === true).toBe(false);
      }
    }
  });

  it('keeps every sector reachable, and the boss and abilities reachable through walls', () => {
    HIDDEN_WORLDS.forEach((map, index) => {
      // Quest key doors already gate part of every one of these worlds, so the property
      // sealing has to preserve is "reaches exactly what the unsealed world reached", not
      // "reaches all 48": no leaf a hidden wall closes may cost the run a single sector.
      expect([...simulate(map, true).reached].sort())
        .toEqual([...simulate(QUEST_WORLDS[index], true).reached].sort());
      const { reached, abilities } = simulate(map, false);
      for (const abilityId of map.abilityOrder) expect(abilities.has(abilityId)).toBe(true);
      expect(reached.has(map.bossArenaKey)).toBe(true);
    });
  });

  it('moves nothing in the layout but the sealed edges themselves', () => {
    QUEST_WORLDS.forEach((plain, index) => {
      const concealed = HIDDEN_WORLDS[index];
      const hiddenKeys = new Set(hiddenKeysOf(concealed));
      expect([...concealed.sectors.keys()]).toEqual([...plain.sectors.keys()]);
      expect(concealed.abilityOrder).toEqual(plain.abilityOrder);
      expect(concealed.bossArenaKey).toBe(plain.bossArenaKey);

      for (const [key, concealedSector] of concealed.sectors) {
        const plainSector = plain.sectors.get(key)!;
        expect(concealedSector.poiSlots).toEqual(plainSector.poiSlots);
        expect(concealedSector.breakables).toEqual(plainSector.breakables);
        expect(concealedSector.entryTiles).toEqual(plainSector.entryTiles);
        expect(concealedSector.depth).toBe(plainSector.depth);
        expect(concealedSector.danger).toBe(plainSector.danger);
        expect(concealedSector.biomeId).toBe(plainSector.biomeId);

        for (const direction of EDGE_DIRECTIONS) {
          const concealedEdge = concealedSector.edges[direction];
          const plainEdge = plainSector.edges[direction];
          const sealsAHiddenRoom = hiddenKeys.has(key)
            || hiddenKeys.has(neighbourKeyOf(concealedSector, direction));
          if (!sealsAHiddenRoom || concealedEdge.kind !== EdgeKind.Breakable) {
            expect(concealedEdge.kind).toBe(plainEdge.kind);
          }
          expect(concealedEdge.apertureStart).toBe(plainEdge.apertureStart);
          expect(concealedEdge.apertureEnd).toBe(plainEdge.apertureEnd);
        }
      }
    });
  });
});

describe('invariant 11: sealed secret caches', () => {
  it('rings every sealed cache with registered breakables and leaves its pocket open', () => {
    let sealed = 0;
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        const rectAt = new Map<number, typeof sector.breakables[number]>();
        for (const rect of sector.breakables) {
          for (let offsetY = 0; offsetY < rect.tileH; offsetY++) {
            for (let offsetX = 0; offsetX < rect.tileW; offsetX++) {
              rectAt.set(tileIndex(rect.tileX + offsetX, rect.tileY + offsetY), rect);
            }
          }
        }
        for (const slot of sector.poiSlots) {
          if (slot.sealed !== true) continue;
          sealed++;
          expect(slot.kind).toBe(PoiKind.Secret);
          expect(sector.isBossArena).toBe(false);
          for (let tileY = slot.tileY - 1; tileY <= slot.tileY + 1; tileY++) {
            for (let tileX = slot.tileX - 1; tileX <= slot.tileX + 1; tileX++) {
              expect(sector.tiles[tileIndex(tileX, tileY)]).toBe(TileKind.Open);
            }
          }
          const ring = secretShellRingIndices(slot.tileX, slot.tileY);
          expect(ring).toHaveLength(16);
          for (const index of ring) {
            const kind = sector.tiles[index];
            expect(kind === TileKind.Solid || kind === TileKind.Breakable).toBe(true);
            if (kind !== TileKind.Breakable) continue;
            // A breakable tile no rect covers is unbreakable in the run. The ring may reuse a
            // carved pocket's cells, so the covering rect is 1x1 only when the shell made it.
            expect(rectAt.get(index)).toBeDefined();
          }
        }
      }
    }
    expect(sealed).toBeGreaterThan(100);
  });

  // Shell cells are appended after carveBreakablePockets, so every pocket keeps the id a
  // profile already remembers breaking. Nothing else pins that ordering.
  it('appends shell cells after every carved pocket', () => {
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        let seenShellCell = false;
        sector.breakables.forEach((rect, index) => {
          expect(rect.id).toBe(`breakable:${sector.sx},${sector.sy}:${index}`);
          const isShellCell = rect.tileW === 1 && rect.tileH === 1;
          if (isShellCell) seenShellCell = true;
          else expect(seenShellCell).toBe(false);
        });
      }
    }
  });
});

describe('invariant 12: void-gapped secret caches', () => {
  it('rings every gapped cache with void tiles no weapon opens, and leaves a way back', () => {
    const inBounds = (tileX: number, tileY: number) =>
      tileX >= 0 && tileX < SECTOR_TILE_COLS && tileY >= 0 && tileY < SECTOR_TILE_ROWS;
    let gapped = 0;
    for (const map of WORLDS) {
      for (const sector of map.sectors.values()) {
        const breakableIndices = new Set<number>();
        for (const rect of sector.breakables) {
          for (let offsetY = 0; offsetY < rect.tileH; offsetY++) {
            for (let offsetX = 0; offsetX < rect.tileW; offsetX++) {
              breakableIndices.add(tileIndex(rect.tileX + offsetX, rect.tileY + offsetY));
            }
          }
        }
        for (const slot of sector.poiSlots) {
          if (slot.gapped !== true) continue;
          gapped++;
          expect(slot.kind).toBe(PoiKind.Secret);
          expect(slot.sealed).not.toBe(true);
          expect(sector.isBossArena).toBe(false);
          for (let tileY = slot.tileY - 1; tileY <= slot.tileY + 1; tileY++) {
            for (let tileX = slot.tileX - 1; tileX <= slot.tileX + 1; tileX++) {
              expect(sector.tiles[tileIndex(tileX, tileY)]).toBe(TileKind.Open);
            }
          }
          const ring = secretShellRingIndices(slot.tileX, slot.tileY);
          expect(ring).toHaveLength(16);
          let voidCells = 0;
          for (const index of ring) {
            const kind = sector.tiles[index];
            expect(kind === TileKind.Solid || kind === TileKind.VoidGap).toBe(true);
            // A registered breakable in the ring would be a hole any weapon opens, and the
            // tether would stop being the key.
            expect(breakableIndices.has(index)).toBe(false);
            if (kind === TileKind.VoidGap) voidCells++;
          }
          expect(voidCells).toBeGreaterThan(0);
          const crossings = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([stepX, stepY]) => {
            const outerX = slot.tileX + stepX * 3;
            const outerY = slot.tileY + stepY * 3;
            if (!inBounds(outerX, outerY)) return false;
            const outer = sector.tiles[tileIndex(outerX, outerY)];
            return sector.tiles[tileIndex(slot.tileX + stepX * 2, slot.tileY + stepY * 2)]
                === TileKind.VoidGap
              && (outer === TileKind.Open || outer === TileKind.HazardFloor);
          });
          expect(crossings.length).toBeGreaterThan(0);
        }
      }
    }
    expect(gapped).toBeGreaterThan(50);
  });
});

describe('worldBoundsRect', () => {
  it('spans exactly the generated sectors, including negative coordinates', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = generateWorld(seed, {
        abilityGateOrder: ['a', 'b', 'c'],
        availableBiomeIds: ['stage_deep_void', 'stage_inferno'],
      });
      const bounds = worldBoundsRect(world);
      const cols = [...world.sectors.values()].map(sector => sector.sx);
      const rows = [...world.sectors.values()].map(sector => sector.sy);

      expect(bounds.minX).toBe(Math.min(...cols) * SECTOR_WIDTH);
      expect(bounds.minY).toBe(Math.min(...rows) * SECTOR_HEIGHT);
      expect(bounds.maxX).toBe((Math.max(...cols) + 1) * SECTOR_WIDTH);
      expect(bounds.maxY).toBe((Math.max(...rows) + 1) * SECTOR_HEIGHT);

      for (const sector of world.sectors.values()) {
        const rect = sectorRectWorld({ col: sector.sx, row: sector.sy });
        expect(rect.minX).toBeGreaterThanOrEqual(bounds.minX);
        expect(rect.minY).toBeGreaterThanOrEqual(bounds.minY);
        expect(rect.maxX).toBeLessThanOrEqual(bounds.maxX);
        expect(rect.maxY).toBeLessThanOrEqual(bounds.maxY);
      }
    }
  });
});
