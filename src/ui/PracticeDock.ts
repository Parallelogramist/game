import Phaser from 'phaser';
import { createMenuButton, MenuButton } from '../visual/MenuButton';
import { OverlayDepths } from '../visual/DepthLayers';
import { getEnemyType } from '../enemies/EnemyTypes';
import { EnemyAffixType } from '../data/Affixes';
import { EndlessMutatorType } from '../data/EndlessMutators';
import {
  PRACTICE_TARGET_IDS,
  PRACTICE_AFFIX_CYCLE,
  nextParagonAffix,
  paragonOptionsFor,
  affixLabel,
} from '../data/PracticeTargets';
import { PRACTICE_BUILD_LADDER } from '../data/PracticeBuild';
import {
  PRACTICE_ARENA_LADDER,
  PRACTICE_MUTATOR_CYCLE,
  PracticeArenaRung,
  practiceMutatorLabel,
} from '../data/PracticeArena';

const DOCK_DEPTH = OverlayDepths.HUD_OVERLAY;

export interface PracticeDockState {
  targetId: string;
  affix: EnemyAffixType;
  affix2: EnemyAffixType;
  invincible: boolean;
}

export interface PracticeDockOptions {
  hudScale: number;
  onSpawn: (state: PracticeDockState) => void;
  onInvincibleChange: (invincible: boolean) => void;
  onBuildChange: (depth: number) => void;
  onArenaChange: (rung: PracticeArenaRung) => void;
  onMutatorChange: (mutator: EndlessMutatorType) => void;
}

/**
 * PRACTICE dock — the in-run sandbox controls: pick a boss-tier target and the
 * exact affixes to put on it, then spawn it as often as you like. Practice-only;
 * GameScene never builds it outside a practice session.
 */
export class PracticeDock {
  private scene: Phaser.Scene;
  private options: PracticeDockOptions;
  private buttons: MenuButton[] = [];

  private targetButton!: MenuButton;
  private affixButton!: MenuButton;
  private affix2Button!: MenuButton;
  private invincibleButton!: MenuButton;
  private buildButton!: MenuButton;
  private arenaButton!: MenuButton;
  private mutatorButton!: MenuButton;

  private targetIndex = 0;
  private affix: EnemyAffixType = EnemyAffixType.NONE;
  private affix2: EnemyAffixType = EnemyAffixType.NONE;
  private invincible = false;
  private buildIndex = 0;
  private arenaIndex = 0;
  private mutator: EndlessMutatorType = EndlessMutatorType.NONE;

  private left = 0;
  private top = 0;
  private right = 0;
  private bottom = 0;

  constructor(scene: Phaser.Scene, options: PracticeDockOptions) {
    this.scene = scene;
    this.options = options;
    this.build();
  }

  private build(): void {
    const scale = this.options.hudScale;
    const width = Math.round(168 * scale);
    const height = Math.max(Math.round(30 * scale), 30);
    const gap = Math.round(6 * scale);
    const rows = 8;
    const x = Math.round(12 * scale) + width / 2;
    const stackHeight = rows * height + (rows - 1) * gap;
    const firstY = this.scene.scale.height / 2 - stackHeight / 2 + height / 2;
    const rowY = (row: number) => firstY + row * (height + gap);
    const fontSize = Math.max(10, Math.round(11 * scale));

    this.left = x - width / 2;
    this.right = x + width / 2;
    this.top = firstY - height / 2;
    this.bottom = rowY(rows - 1) + height / 2;

    this.targetButton = createMenuButton({
      scene: this.scene, x, y: rowY(0), width, height, fontSize,
      label: '', variant: 'neutral',
      onActivate: () => {
        this.targetIndex = (this.targetIndex + 1) % PRACTICE_TARGET_IDS.length;
        this.clampAffixesToTarget();
        this.refreshLabels();
      },
    });

    this.affixButton = createMenuButton({
      scene: this.scene, x, y: rowY(1), width, height, fontSize,
      label: '', variant: 'neutral',
      onActivate: () => {
        const index = PRACTICE_AFFIX_CYCLE.indexOf(this.affix);
        this.affix = PRACTICE_AFFIX_CYCLE[(index + 1) % PRACTICE_AFFIX_CYCLE.length];
        if (!paragonOptionsFor(this.affix).includes(this.affix2)) this.affix2 = EnemyAffixType.NONE;
        this.refreshLabels();
      },
    });

    this.affix2Button = createMenuButton({
      scene: this.scene, x, y: rowY(2), width, height, fontSize,
      label: '', variant: 'neutral',
      onActivate: () => {
        this.affix2 = nextParagonAffix(this.affix, this.affix2);
        this.refreshLabels();
      },
    });

    this.buildButton = createMenuButton({
      scene: this.scene, x, y: rowY(3), width, height, fontSize,
      label: '', variant: 'neutral',
      onActivate: () => {
        if (this.buildIndex >= PRACTICE_BUILD_LADDER.length - 1) return;
        this.buildIndex++;
        this.options.onBuildChange(PRACTICE_BUILD_LADDER[this.buildIndex].depth);
        this.refreshLabels();
      },
    });

    this.arenaButton = createMenuButton({
      scene: this.scene, x, y: rowY(4), width, height, fontSize,
      label: '', variant: 'neutral',
      onActivate: () => {
        if (this.arenaIndex >= PRACTICE_ARENA_LADDER.length - 1) return;
        this.arenaIndex++;
        this.options.onArenaChange(PRACTICE_ARENA_LADDER[this.arenaIndex]);
        this.refreshLabels();
      },
    });

    this.mutatorButton = createMenuButton({
      scene: this.scene, x, y: rowY(5), width, height, fontSize,
      label: '', variant: 'neutral',
      onActivate: () => {
        const index = PRACTICE_MUTATOR_CYCLE.indexOf(this.mutator);
        this.mutator = PRACTICE_MUTATOR_CYCLE[(index + 1) % PRACTICE_MUTATOR_CYCLE.length];
        this.options.onMutatorChange(this.mutator);
        this.refreshLabels();
      },
    });

    this.invincibleButton = createMenuButton({
      scene: this.scene, x, y: rowY(6), width, height, fontSize,
      label: '', variant: 'neutral',
      onActivate: () => {
        this.invincible = !this.invincible;
        this.options.onInvincibleChange(this.invincible);
        this.refreshLabels();
      },
    });

    const spawnButton = createMenuButton({
      scene: this.scene, x, y: rowY(7), width, height, fontSize,
      label: 'SPAWN', variant: 'gold',
      onActivate: () => this.options.onSpawn(this.getState()),
    });

    this.buttons = [this.targetButton, this.affixButton, this.affix2Button,
                    this.buildButton, this.arenaButton, this.mutatorButton,
                    this.invincibleButton, spawnButton];
    for (const button of this.buttons) {
      button.container.setDepth(DOCK_DEPTH);
      button.container.setScrollFactor(0);
      button.card.hitZone.on('pointerover', () => button.setHoverState(true));
      button.card.hitZone.on('pointerout', () => button.setHoverState(false));
    }

    this.refreshLabels();
  }

  /** The Legion is affix-excluded at spawn (see GameScene.spawnBoss) — don't offer affixes that can't apply. */
  private affixesApplyToTarget(): boolean {
    return PRACTICE_TARGET_IDS[this.targetIndex] !== 'the_legion';
  }

  private clampAffixesToTarget(): void {
    if (this.affixesApplyToTarget()) return;
    this.affix = EnemyAffixType.NONE;
    this.affix2 = EnemyAffixType.NONE;
  }

  private refreshLabels(): void {
    const targetId = PRACTICE_TARGET_IDS[this.targetIndex];
    const targetName = getEnemyType(targetId)?.name ?? targetId;
    this.targetButton.setLabel(targetName.toUpperCase());

    const applies = this.affixesApplyToTarget();
    this.affixButton.setLabel(applies ? `AFFIX: ${affixLabel(this.affix)}` : 'AFFIX: N/A');
    this.affixButton.setEnabled(applies);
    this.affixButton.setVariant(applies && this.affix !== EnemyAffixType.NONE ? 'magenta' : 'neutral');

    const paragonAvailable = applies && this.affix !== EnemyAffixType.NONE;
    this.affix2Button.setLabel(paragonAvailable ? `2ND: ${affixLabel(this.affix2)}` : '2ND: —');
    this.affix2Button.setEnabled(paragonAvailable);
    this.affix2Button.setVariant(paragonAvailable && this.affix2 !== EnemyAffixType.NONE ? 'magenta' : 'neutral');

    const rung = PRACTICE_BUILD_LADDER[this.buildIndex];
    this.buildButton.setLabel(`BUILD: ${rung.label}`);
    this.buildButton.setEnabled(this.buildIndex < PRACTICE_BUILD_LADDER.length - 1);

    const arenaRung = PRACTICE_ARENA_LADDER[this.arenaIndex];
    this.arenaButton.setLabel(`ARENA: ${arenaRung.label}`);
    this.arenaButton.setEnabled(this.arenaIndex < PRACTICE_ARENA_LADDER.length - 1);

    this.mutatorButton.setLabel(`MUTATOR: ${practiceMutatorLabel(this.mutator)}`);

    this.invincibleButton.setLabel(`INVINCIBLE: ${this.invincible ? 'ON' : 'OFF'}`);
    this.invincibleButton.setVariant(this.invincible ? 'safe' : 'neutral');
  }

  getState(): PracticeDockState {
    return {
      targetId: PRACTICE_TARGET_IDS[this.targetIndex],
      affix: this.affix,
      affix2: this.affix2,
      invincible: this.invincible,
    };
  }

  containsPoint(x: number, y: number): boolean {
    return x >= this.left && x <= this.right && y >= this.top && y <= this.bottom;
  }

  destroy(): void {
    for (const button of this.buttons) button.destroy();
    this.buttons = [];
  }
}
