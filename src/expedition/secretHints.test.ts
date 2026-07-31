import { describe, test, expect } from 'vitest';
import { generateWorld } from '../world/generateWorld';
import { PoiKind } from '../world/worldTypes';
import type { SectorDef, WorldMap } from '../world/worldTypes';
import { STAGES, getStageById } from '../data/Stages';
import { LORE_FRAGMENTS } from '../data/LoreFragments';
import { buildSecretLead, chooseHintTarget, describeSecretLocation, loreFragmentFor } from './secretHints';
import { buildSecretPuzzle, describePuzzleSequence } from '../world/secretPuzzles';

const INPUTS = {
  abilityGateOrder: ['blink_drive', 'breach_charges', 'magno_tether',
    'phase_cloak', 'thermal_ward', 'signal_decryptor'],
  availableBiomeIds: STAGES.map(stage => stage.id),
  hiddenSectorCount: 3,
};
const WORLDS = [12345, 20264, 28183, 36102, 44021].map(seed => generateWorld(seed, INPUTS));

function secretsOf(world: WorldMap): { secretId: string; sector: SectorDef }[] {
  const found: { secretId: string; sector: SectorDef }[] = [];
  for (const sector of world.sectors.values()) {
    for (const slot of sector.poiSlots) {
      if (slot.kind === PoiKind.Secret) found.push({ secretId: slot.id, sector });
    }
  }
  return found;
}

function chebyshev(a: SectorDef, b: SectorDef): number {
  return Math.max(Math.abs(a.sx - b.sx), Math.abs(a.sy - b.sy));
}

describe('secretHints', () => {
  test('every riddle names a biome, a depth and a shape the world really has', () => {
    expect(LORE_FRAGMENTS.length).toBeGreaterThan(0);
    for (const world of WORLDS) {
      for (const { sector } of secretsOf(world)) {
        const riddle = describeSecretLocation(world, sector);
        expect(riddle.endsWith('.')).toBe(true);

        const stage = getStageById(sector.biomeId);
        expect(riddle).toContain(stage ? stage.name : 'uncharted space');
        for (const other of STAGES) {
          if (stage && other.id === stage.id) continue;
          expect(riddle).not.toContain(other.name);
        }

        if (sector.key === world.startKey) expect(riddle).toContain('hangar itself');
        else expect(riddle).toContain(String(sector.depth));
      }
    }
  });

  test('a lead never names a secret inside an unvisited hidden sector', () => {
    const noVisits = new Set<string>();
    for (const world of WORLDS) {
      const secrets = secretsOf(world);
      const sectorOfSecret = new Map(secrets.map(entry => [entry.secretId, entry.sector]));
      for (const { secretId } of secrets) {
        const target = chooseHintTarget({
          map: world,
          knownSecretIds: new Set(),
          visitedSectorKeys: noVisits,
          sourceSecretId: secretId,
        });
        if (target === null) continue;
        expect(sectorOfSecret.get(target)?.hidden).not.toBe(true);
      }
    }

    let namedAHiddenSecret = false;
    for (const world of WORLDS) {
      const secrets = secretsOf(world);
      const sectorOfSecret = new Map(secrets.map(entry => [entry.secretId, entry.sector]));
      const allVisited = new Set(
        [...world.sectors.values()].filter(sector => sector.hidden === true)
          .map(sector => sector.key),
      );
      for (const { secretId } of secrets) {
        const target = chooseHintTarget({
          map: world,
          knownSecretIds: new Set(),
          visitedSectorKeys: allVisited,
          sourceSecretId: secretId,
        });
        if (target !== null && sectorOfSecret.get(target)?.hidden === true) {
          namedAHiddenSecret = true;
        }
      }
    }
    expect(namedAHiddenSecret).toBe(true);
  });

  test('a lead never names the secret that produced it, nor one already known', () => {
    for (const world of WORLDS) {
      const secrets = secretsOf(world);
      const allVisited = new Set([...world.sectors.values()].map(sector => sector.key));
      const known = new Set(secrets.slice(0, 3).map(entry => entry.secretId));
      for (const { secretId } of secrets) {
        const target = chooseHintTarget({
          map: world,
          knownSecretIds: known,
          visitedSectorKeys: allVisited,
          sourceSecretId: secretId,
        });
        if (target === null) continue;
        expect(target).not.toBe(secretId);
        expect(known.has(target)).toBe(false);
      }
    }
  });

  test('the same world and the same find always name the same secret', () => {
    for (const world of WORLDS) {
      const secrets = secretsOf(world);
      const allVisited = new Set([...world.sectors.values()].map(sector => sector.key));
      const inputs = {
        map: world,
        knownSecretIds: new Set<string>(),
        visitedSectorKeys: allVisited,
        sourceSecretId: secrets[0].secretId,
      };
      expect(chooseHintTarget(inputs)).toBe(chooseHintTarget(inputs));
    }
  });

  test('a lead comes from the three nearest candidates', () => {
    for (const world of WORLDS) {
      const secrets = secretsOf(world);
      const sectorOfSecret = new Map(secrets.map(entry => [entry.secretId, entry.sector]));
      const allVisited = new Set([...world.sectors.values()].map(sector => sector.key));
      for (const { secretId, sector } of secrets) {
        const target = chooseHintTarget({
          map: world,
          knownSecretIds: new Set(),
          visitedSectorKeys: allVisited,
          sourceSecretId: secretId,
        });
        if (target === null) continue;
        const distances = secrets.filter(entry => entry.secretId !== secretId)
          .map(entry => chebyshev(entry.sector, sector))
          .sort((a, b) => a - b);
        const thirdNearest = distances[Math.min(2, distances.length - 1)];
        expect(chebyshev(sectorOfSecret.get(target)!, sector)).toBeLessThanOrEqual(thirdNearest);
      }
    }
  });

  test('a world with nothing left to point at returns null', () => {
    for (const world of WORLDS) {
      const secrets = secretsOf(world);
      const everything = new Set(secrets.map(entry => entry.secretId));
      expect(chooseHintTarget({
        map: world,
        knownSecretIds: everything,
        visitedSectorKeys: new Set([...world.sectors.values()].map(sector => sector.key)),
        sourceSecretId: secrets[0].secretId,
      })).toBeNull();
      expect(buildSecretLead(world, 'secret_that_no_sector_carries')).toBeNull();
    }
  });

  test('a lead into a sealed cache carries its sigils, a walk-in lead carries none', () => {
    let sawSealed = false;
    let sawWalkIn = false;
    for (const world of WORLDS) {
      for (const { secretId, sector } of secretsOf(world)) {
        const lead = buildSecretLead(world, secretId);
        expect(lead).not.toBeNull();
        const puzzle = buildSecretPuzzle({
          worldSeed: world.seed, secretId, depth: sector.depth,
        });
        if (puzzle) {
          sawSealed = true;
          expect(lead!.sigils).toBe(describePuzzleSequence(puzzle));
        } else {
          sawWalkIn = true;
          expect(lead!.sigils).toBeUndefined();
        }
      }
    }
    expect(sawSealed).toBe(true);
    expect(sawWalkIn).toBe(true);
  });

  test('every lore fragment is dealt at least once in a world the player can clear', () => {
    const liveWorld = generateWorld(20260727, INPUTS);
    for (const world of [...WORLDS, liveWorld]) {
      const dealt = new Set(
        secretsOf(world).map(({ secretId }) => loreFragmentFor(world, secretId).id),
      );
      expect(secretsOf(world).length).toBeGreaterThanOrEqual(LORE_FRAGMENTS.length);
      expect(dealt.size).toBe(LORE_FRAGMENTS.length);
    }
  });
});
