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
import { showCodeEntryOverlay } from '../../ui/CodeEntryOverlay';
import { fitTextWidth, resolveMenuFontScale, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';

const TITLE_FONT = '"Atkinson Hyperlegible", Arial, sans-serif';
/**
 * Design-space units the scene needs outside the row stack: 160 above the first row, then
 * the flash line, the build-code bar, BACK and the bottom margin below it. The stack is one
 * full-height column, so scaling past this budget is what would drop its last row behind
 * the bar.
 */
const CHROME_RESERVE = 335;

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
  private layoutScale = 1;
  private flashText: Phaser.GameObjects.Text | null = null;
  private codeEntryTeardown: (() => void) | null = null;

  constructor() {
    super({ key: 'LoadoutScene' });
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.isLeaving = false;
    this.navigator = null;
    this.flashText = null;
    this.codeEntryTeardown = null;
    this.cameras.main.setBackgroundColor('#0a0a14');
    this.cameras.main.fadeIn(200, 0, 0, 0);

    const rows = this.buildRows();
    const menuScale = resolveMenuFontScale(width, height, getSettingsManager().getUiScale());
    const naturalStackHeight = rows.length * 62 + Math.max(0, rows.length - 1) * 14;
    this.layoutScale = Math.min(menuScale, height / (naturalStackHeight + CHROME_RESERVE));

    const title = this.add.text(width / 2, scaledInt(this.layoutScale, 54), 'LOADOUTS', {
      fontSize: `${scaledInt(this.layoutScale, 44)}px`,
      color: '#66ccff',
      fontFamily: TITLE_FONT,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6 * this.layoutScale,
    }).setOrigin(0.5).setLetterSpacing(3 * this.layoutScale);
    fitTextWidth(title, width - 24);

    const subtitle = this.add.text(width / 2, scaledInt(this.layoutScale, 102),
      'Replay a run, save a favourite, or share builds with codes.', {
        fontSize: `${scaledInt(this.layoutScale, 16)}px`,
        color: '#9999bb',
        fontFamily: 'Arial',
      }).setOrigin(0.5);
    fitTextWidth(subtitle, width - 24);

    const cardWidth = Math.min(scaledInt(this.layoutScale, 560), width - scaledInt(this.layoutScale, 40));
    const cardHeight = scaledInt(this.layoutScale, 62);
    const gap = scaledInt(this.layoutScale, 14);
    const firstRowY = scaledInt(this.layoutScale, 160);

    const navigableItems: NavigableItem[] = [];

    rows.forEach((row, index) => {
      const rowCenterY = firstRowY + index * (cardHeight + gap) + cardHeight / 2;
      const bg = this.add.rectangle(width / 2, rowCenterY, cardWidth, cardHeight, 0x14141f)
        .setStrokeStyle(2, 0x333344)
        .setInteractive({ useHandCursor: true });

      const leftX = width / 2 - cardWidth / 2 + scaledInt(this.layoutScale, 18);
      this.add.text(leftX, rowCenterY - scaledInt(this.layoutScale, 12), row.label, {
        fontSize: `${scaledInt(this.layoutScale, 18)}px`,
        color: row.kind === 'save' ? '#88ffaa' : '#ffffff',
        fontFamily: TITLE_FONT,
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      if (row.detail) {
        this.add.text(leftX, rowCenterY + scaledInt(this.layoutScale, 13), row.detail, {
          fontSize: `${scaledInt(this.layoutScale, 13)}px`,
          color: '#9aabd0',
          fontFamily: 'Arial',
        }).setOrigin(0, 0.5);
      }
      this.add.text(width / 2 + cardWidth / 2 - scaledInt(this.layoutScale, 18), rowCenterY,
        row.kind === 'save' ? 'SAVE' : 'PLAY', {
        fontSize: `${scaledInt(this.layoutScale, 14)}px`,
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
    // A fixed bar above BACK, deliberately NOT extra list rows — so the tuned row
    // list (replay/presets/save) and its density stay untouched. COPY drops out when
    // there is no last run to encode, so the bar is two buttons wide or three.
    const codeSourceLoadout = loadLastLoadout();
    const barActions: { label: string; activate: () => void }[] = [];
    if (codeSourceLoadout) {
      barActions.push({ label: 'COPY CODE', activate: () => this.copyBuildCode() });
    }
    barActions.push({ label: 'PASTE & LAUNCH', activate: () => { void this.pasteAndLaunchCode(); } });
    barActions.push({ label: 'ENTER CODE', activate: () => this.openBuildCodeEntry() });

    const barY = height - scaledInt(this.layoutScale, 112);
    const barGap = scaledInt(this.layoutScale, 16);
    const barButtonWidth = Math.min(
      scaledInt(this.layoutScale, 258),
      (cardWidth - barGap * (barActions.length - 1)) / barActions.length,
    );
    const barButtonHeight = scaledInt(this.layoutScale, 42);
    const barSpan = barActions.length * barButtonWidth + (barActions.length - 1) * barGap;
    const barFirstCenterX = width / 2 - barSpan / 2 + barButtonWidth / 2;

    barActions.forEach((action, barIndex) => {
      const barCenterX = barFirstCenterX + barIndex * (barButtonWidth + barGap);
      const barNavIndex = navigableItems.length;
      const barButtonBg = this.add.rectangle(barCenterX, barY, barButtonWidth, barButtonHeight, 0x121820)
        .setStrokeStyle(2, 0x3a5a7a)
        .setInteractive({ useHandCursor: true });
      const barButtonLabel = this.add.text(barCenterX, barY, action.label, {
        fontSize: `${scaledInt(this.layoutScale, 14)}px`,
        color: '#88ccff',
        fontFamily: TITLE_FONT,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      fitTextWidth(barButtonLabel, barButtonWidth - scaledInt(this.layoutScale, 14));
      barButtonBg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        if (!pointer.wasTouch) this.navigator?.selectIndex(barNavIndex);
      });
      barButtonBg.on('pointerup', action.activate);
      navigableItems.push({
        onFocus: () => barButtonBg.setStrokeStyle(2, 0xffffff, 0.9),
        onBlur: () => barButtonBg.setStrokeStyle(2, 0x3a5a7a),
        onActivate: action.activate,
      });
    });

    const backY = height - scaledInt(this.layoutScale, 54);
    const backButton = this.add.rectangle(width / 2, backY,
      scaledInt(this.layoutScale, 220), scaledInt(this.layoutScale, 46), 0x1a1a2a)
      .setStrokeStyle(2, 0x5566aa)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, backY, 'BACK', {
      fontSize: `${scaledInt(this.layoutScale, 20)}px`,
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
      return;
    }
    this.openBuildCodeEntry();
  }

  /**
   * Reached two ways on purpose: the ENTER CODE bar button, and PASTE & LAUNCH's failure branch,
   * which still lands here when the clipboard is empty, unreadable or not a build code. A
   * clipboard hit still launches in one press exactly as before.
   */
  private openBuildCodeEntry(): void {
    if (this.isLeaving || this.codeEntryTeardown) return;
    this.navigator?.setEnabled(false);
    this.codeEntryTeardown = showCodeEntryOverlay<LastLoadout>({
      title: 'ENTER BUILD CODE',
      body: 'Type or paste a build code to launch that run.',
      placeholder: 'PPS1-...',
      submitLabel: 'LAUNCH',
      autocapitalize: 'off',
      decode: (typed) => {
        const typedLoadout = decodeLoadoutCode(typed);
        return typedLoadout
          ? { ok: true, value: typedLoadout }
          : { ok: false, error: 'That is not a build code.' };
      },
      onSubmit: (typedLoadout) => {
        this.codeEntryTeardown = null;
        this.navigator?.setEnabled(true);
        this.launch(typedLoadout);
      },
      onClose: () => {
        this.codeEntryTeardown = null;
        this.navigator?.setEnabled(true);
      },
    });
  }

  private showFlash(message: string): void {
    this.flashText?.destroy();
    this.flashText = this.add.text(this.scale.width / 2,
      this.scale.height - scaledInt(this.layoutScale, 158), message, {
      fontSize: `${scaledInt(this.layoutScale, 15)}px`,
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
    this.codeEntryTeardown?.();
    this.codeEntryTeardown = null;
    this.tweens.killAll();
    this.flashText?.destroy();
    this.flashText = null;
  }
}
