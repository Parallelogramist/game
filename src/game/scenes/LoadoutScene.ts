import Phaser from 'phaser';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { transitionToScene } from '../../utils/SceneTransition';
import { loadLastLoadout, type LastLoadout } from '../../meta/LastLoadout';
import {
  loadLoadoutPresets,
  saveLoadoutPreset,
  isLoadoutSaved,
  setPendingReplay,
  MAX_LOADOUT_PRESETS,
} from '../../meta/LoadoutPresets';
import { getShipById } from '../../data/ShipCharacters';
import { getStageById } from '../../data/Stages';
import { getWeaponInfoList } from '../../weapons';
import { copyTextToClipboard } from '../../utils/Clipboard';
import { encodeLoadoutCode, decodeLoadoutCode } from '../../meta/LoadoutCode';

const TITLE_FONT = '"Atkinson Hyperlegible", Arial, sans-serif';

interface LoadoutRow {
  kind: 'replay' | 'preset' | 'save';
  label: string;
  detail: string;
  loadout?: LastLoadout;
}

/**
 * LOADOUTS menu — replay the last run, one-tap replay a saved preset, or save the
 * current loadout as a preset. Launching hands the chosen loadout to BootScene
 * (via LoadoutPresets' pending-replay handoff), which reuses its existing
 * confirm/clear-save/re-roll-modifiers/fade path. This scene owns no launch logic.
 */
export class LoadoutScene extends Phaser.Scene {
  private navigator: MenuNavigator | null = null;
  private isLeaving = false;
  private flashText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: 'LoadoutScene' });
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.isLeaving = false;
    this.navigator = null;
    this.flashText = null;
    this.cameras.main.setBackgroundColor('#0a0a14');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    this.add.text(width / 2, 54, 'LOADOUTS', {
      fontSize: '44px',
      color: '#66ccff',
      fontFamily: TITLE_FONT,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5).setLetterSpacing(3);

    this.add.text(width / 2, 102, 'Replay a run, save a favourite, or share builds with codes.', {
      fontSize: '16px',
      color: '#9999bb',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    const rows = this.buildRows();
    const cardWidth = Math.min(560, width - 40);
    const cardHeight = 62;
    const gap = 14;
    const firstRowY = 160;

    const navigableItems: NavigableItem[] = [];

    rows.forEach((row, index) => {
      const rowCenterY = firstRowY + index * (cardHeight + gap) + cardHeight / 2;
      const bg = this.add.rectangle(width / 2, rowCenterY, cardWidth, cardHeight, 0x14141f)
        .setStrokeStyle(2, 0x333344)
        .setInteractive({ useHandCursor: true });

      const leftX = width / 2 - cardWidth / 2 + 18;
      this.add.text(leftX, rowCenterY - 12, row.label, {
        fontSize: '18px',
        color: row.kind === 'save' ? '#88ffaa' : '#ffffff',
        fontFamily: TITLE_FONT,
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      if (row.detail) {
        this.add.text(leftX, rowCenterY + 13, row.detail, {
          fontSize: '13px',
          color: '#9aabd0',
          fontFamily: 'Arial',
        }).setOrigin(0, 0.5);
      }
      this.add.text(width / 2 + cardWidth / 2 - 18, rowCenterY, row.kind === 'save' ? 'SAVE' : 'PLAY', {
        fontSize: '14px',
        color: row.kind === 'save' ? '#88ffaa' : '#ffd24a',
        fontFamily: TITLE_FONT,
        fontStyle: 'bold',
      }).setOrigin(1, 0.5);

      const activate = () => this.activateRow(row);
      // Hover-follows-mouse only: on touch a tap fires pointerover with no
      // pointerout after it, which would strand the focus ring on that row.
      bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        if (!pointer.wasTouch) this.navigator?.selectIndex(index);
      });
      bg.on('pointerup', activate);
      navigableItems.push({
        onFocus: () => bg.setStrokeStyle(2, 0xffffff, 0.9),
        onBlur: () => bg.setStrokeStyle(2, 0x333344),
        onActivate: activate,
      });
    });

    // ─── build-code bar: share loadouts as copy/paste codes ─────────────
    // A fixed two-button bar above BACK, deliberately NOT extra list rows — so
    // the tuned row list (replay/presets/save) and its density stay untouched.
    const codeSourceLoadout = loadLastLoadout();
    const barY = height - 112;
    const barButtonWidth = Math.min(258, (cardWidth - 18) / 2);
    const barButtonHeight = 42;
    const barGap = 16;
    const copyCenterX = width / 2 - (barButtonWidth + barGap) / 2;
    const pasteCenterX = codeSourceLoadout
      ? width / 2 + (barButtonWidth + barGap) / 2
      : width / 2;

    if (codeSourceLoadout) {
      const copyIndex = navigableItems.length;
      const copyBg = this.add.rectangle(copyCenterX, barY, barButtonWidth, barButtonHeight, 0x121820)
        .setStrokeStyle(2, 0x3a5a7a)
        .setInteractive({ useHandCursor: true });
      this.add.text(copyCenterX, barY, 'COPY BUILD CODE', {
        fontSize: '14px',
        color: '#88ccff',
        fontFamily: TITLE_FONT,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      const doCopy = () => this.copyBuildCode();
      copyBg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        if (!pointer.wasTouch) this.navigator?.selectIndex(copyIndex);
      });
      copyBg.on('pointerup', doCopy);
      navigableItems.push({
        onFocus: () => copyBg.setStrokeStyle(2, 0xffffff, 0.9),
        onBlur: () => copyBg.setStrokeStyle(2, 0x3a5a7a),
        onActivate: doCopy,
      });
    }

    const pasteIndex = navigableItems.length;
    const pasteBg = this.add.rectangle(pasteCenterX, barY, barButtonWidth, barButtonHeight, 0x121820)
      .setStrokeStyle(2, 0x3a5a7a)
      .setInteractive({ useHandCursor: true });
    this.add.text(pasteCenterX, barY, 'PASTE & LAUNCH CODE', {
      fontSize: '14px',
      color: '#88ccff',
      fontFamily: TITLE_FONT,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const doPaste = () => { void this.pasteAndLaunchCode(); };
    pasteBg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) this.navigator?.selectIndex(pasteIndex);
    });
    pasteBg.on('pointerup', doPaste);
    navigableItems.push({
      onFocus: () => pasteBg.setStrokeStyle(2, 0xffffff, 0.9),
      onBlur: () => pasteBg.setStrokeStyle(2, 0x3a5a7a),
      onActivate: doPaste,
    });

    const backButton = this.add.rectangle(width / 2, height - 54, 220, 46, 0x1a1a2a)
      .setStrokeStyle(2, 0x5566aa)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height - 54, 'BACK', {
      fontSize: '20px',
      color: '#aabbdd',
      fontFamily: TITLE_FONT,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    backButton.on('pointerup', () => this.goBack());
    navigableItems.push({
      onFocus: () => backButton.setStrokeStyle(2, 0xffffff, 0.9),
      onBlur: () => backButton.setStrokeStyle(2, 0x5566aa),
      onActivate: () => this.goBack(),
    });

    this.navigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: 1,
      wrap: true,
      onCancel: () => this.goBack(),
    });

    this.events.once('shutdown', this.shutdown, this);
  }

  private buildRows(): LoadoutRow[] {
    const rows: LoadoutRow[] = [];
    const lastLoadout = loadLastLoadout();
    const presets = loadLoadoutPresets();

    if (lastLoadout) {
      rows.push({ kind: 'replay', label: 'REPLAY LAST RUN', detail: this.describeLoadout(lastLoadout), loadout: lastLoadout });
    }
    for (const preset of presets) {
      rows.push({ kind: 'preset', label: this.nameLoadout(preset), detail: this.describeLoadout(preset), loadout: preset });
    }
    if (lastLoadout && !isLoadoutSaved(lastLoadout, presets)) {
      const full = presets.length >= MAX_LOADOUT_PRESETS;
      rows.push({
        kind: 'save',
        label: full ? 'SAVE CURRENT (REPLACES OLDEST)' : 'SAVE CURRENT LOADOUT',
        detail: '',
      });
    }
    return rows;
  }

  private nameLoadout(loadout: LastLoadout): string {
    const ship = getShipById(loadout.shipId ?? 'ship_default')?.name ?? 'Ship';
    const stage = getStageById(loadout.stageId ?? 'stage_deep_void')?.name ?? 'Stage';
    return `${ship} · ${stage}`;
  }

  private describeLoadout(loadout: LastLoadout): string {
    const weapon = getWeaponInfoList().find((info) => info.id === loadout.startingWeapon)?.name ?? loadout.startingWeapon;
    const pactCount = loadout.pactIds?.length ?? 0;
    const pactLabel = pactCount > 0 ? ` · ${pactCount} pact${pactCount > 1 ? 's' : ''}` : '';
    const gauntletLabel = loadout.gauntletMode ? ' · Gauntlet' : '';
    return `${weapon} · T${loadout.threatLevel}${pactLabel}${gauntletLabel}`;
  }

  private activateRow(row: LoadoutRow): void {
    if (this.isLeaving) return;
    if (row.kind === 'save') {
      const lastLoadout = loadLastLoadout();
      if (lastLoadout) saveLoadoutPreset(lastLoadout);
      this.scene.restart();
      return;
    }
    if (row.loadout) this.launch(row.loadout);
  }

  private launch(loadout: LastLoadout): void {
    if (this.isLeaving) return;
    this.isLeaving = true;
    setPendingReplay(loadout);
    this.input.keyboard?.removeAllListeners();
    this.cameras.main.fadeOut(150, 0, 0, 0);
    this.time.delayedCall(160, () => this.scene.start('BootScene'));
  }

  private copyBuildCode(): void {
    if (this.isLeaving) return;
    const loadout = loadLastLoadout();
    if (!loadout) return;
    void copyTextToClipboard(encodeLoadoutCode(loadout)).then((copied) => {
      if (this.isLeaving) return;
      this.showFlash(copied ? 'Build code copied to clipboard' : 'Could not access the clipboard');
    });
  }

  private async pasteAndLaunchCode(): Promise<void> {
    if (this.isLeaving) return;
    let clipboardText = '';
    try {
      clipboardText = (await navigator.clipboard?.readText?.()) ?? '';
    } catch {
      clipboardText = '';
    }
    if (this.isLeaving) return;
    const loadout = decodeLoadoutCode(clipboardText);
    if (loadout) {
      this.launch(loadout);
    } else {
      this.showFlash('No valid build code on the clipboard');
    }
  }

  private showFlash(message: string): void {
    this.flashText?.destroy();
    this.flashText = this.add.text(this.scale.width / 2, this.scale.height - 158, message, {
      fontSize: '15px',
      color: '#ffe08a',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    this.tweens.add({
      targets: this.flashText,
      alpha: { from: 1, to: 0 },
      delay: 1300,
      duration: 600,
      onComplete: () => {
        this.flashText?.destroy();
        this.flashText = null;
      },
    });
  }

  private goBack(): void {
    if (this.isLeaving) return;
    this.isLeaving = true;
    transitionToScene(this, 'BootScene');
  }

  private shutdown(): void {
    if (this.navigator) {
      this.navigator.destroy();
      this.navigator = null;
    }
    this.tweens.killAll();
    this.flashText?.destroy();
    this.flashText = null;
  }
}
