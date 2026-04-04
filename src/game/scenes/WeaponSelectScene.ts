import Phaser from 'phaser';
import { getCodexManager } from '../../codex';
import { getWeaponInfoList, WeaponInfo } from '../../weapons';
import { createIcon } from '../../utils/IconRenderer';
import { fadeIn, fadeOut, addButtonInteraction } from '../../utils/SceneTransition';
import { SoundManager } from '../../audio/SoundManager';
import { selectRunModifiers } from '../../data/RunModifiers';
import { MenuNavigator } from '../../input/MenuNavigator';

/**
 * WeaponSelectScene - Pre-run weapon selection screen.
 * Shows discovered weapons from the Codex and lets the player pick a starting weapon.
 * Skips automatically if only the default Projectile has been discovered.
 */
interface WeaponCardRef {
  cardBackground: Phaser.GameObjects.Rectangle;
  nameText: Phaser.GameObjects.Text;
  iconSprite: Phaser.GameObjects.Image;
  weaponId: string;
}

export class WeaponSelectScene extends Phaser.Scene {
  private soundManager!: SoundManager;
  private menuNavigator: MenuNavigator | null = null;
  private weaponCardRefs: WeaponCardRef[] = [];

  constructor() {
    super({ key: 'WeaponSelectScene' });
  }

  create(): void {
    this.events.once('shutdown', this.shutdown, this);
    this.soundManager = new SoundManager(this);

    const codexManager = getCodexManager();
    const allWeapons = getWeaponInfoList();

    // Filter to only discovered weapons
    const discoveredWeapons = allWeapons.filter(
      weaponInfo => codexManager.isWeaponDiscovered(weaponInfo.id)
    );

    // If only projectile (or nothing) discovered, skip straight to game
    if (discoveredWeapons.length <= 1) {
      const selectedModifiers = selectRunModifiers(2);
      this.scene.start('GameScene', {
        restore: false,
        startingWeapon: 'projectile',
        modifierIds: selectedModifiers.map(m => m.id),
      });
      return;
    }

    fadeIn(this, 200);

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    // Background
    this.add.rectangle(centerX, centerY, this.scale.width, this.scale.height, 0x0a0a1a);

    // Title
    this.add.text(centerX, 50, 'CHOOSE YOUR WEAPON', {
      fontSize: '36px',
      color: '#ffdd44',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    this.add.text(centerX, 90, 'Select the weapon you want to start your run with', {
      fontSize: '16px',
      color: '#888899',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // Build weapon cards
    this.weaponCardRefs = [];
    this.buildWeaponCards(discoveredWeapons, centerX, centerY);

    // "Random" button at bottom
    const randomButtonY = this.scale.height - 50;
    const randomText = this.add.text(centerX, randomButtonY, '[ RANDOM ]', {
      fontSize: '20px',
      color: '#aaaacc',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);

    randomText.setInteractive({ useHandCursor: true });
    addButtonInteraction(this, randomText);
    randomText.on('pointerdown', () => {
      const randomWeapon = discoveredWeapons[Math.floor(Math.random() * discoveredWeapons.length)];
      this.selectWeapon(randomWeapon.id);
    });

    // Keyboard shortcuts hint
    this.add.text(centerX, this.scale.height - 20, 'Press 1-9 to quick select  |  R for random', {
      fontSize: '12px',
      color: '#555566',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // Build navigable items: weapon cards + random button at end
    const gridColumns = Math.min(discoveredWeapons.length, 7);
    const navigableItems = this.weaponCardRefs.map((cardRef) => ({
      onFocus: () => this.focusWeaponCard(cardRef),
      onBlur: () => this.blurWeaponCard(cardRef),
      onActivate: () => {
        this.soundManager.playUIClick();
        this.selectWeapon(cardRef.weaponId);
      },
    }));

    // Add the "Random" button as a navigable item after the grid
    navigableItems.push({
      onFocus: () => randomText.setColor('#ffdd44'),
      onBlur: () => randomText.setColor('#aaaacc'),
      onActivate: () => {
        const randomWeapon = discoveredWeapons[Math.floor(Math.random() * discoveredWeapons.length)];
        this.selectWeapon(randomWeapon.id);
      },
    });

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: navigableItems,
      columns: gridColumns,
      wrap: true,
    });

    // Keyboard shortcuts for number keys and R (not handled by MenuNavigator)
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      const keyNumber = parseInt(event.key);
      if (keyNumber >= 1 && keyNumber <= discoveredWeapons.length) {
        this.selectWeapon(discoveredWeapons[keyNumber - 1].id);
      }
      if (event.key === 'r' || event.key === 'R') {
        const randomWeapon = discoveredWeapons[Math.floor(Math.random() * discoveredWeapons.length)];
        this.selectWeapon(randomWeapon.id);
      }
    });
  }

  /**
   * Build weapon selection cards in a responsive grid layout.
   */
  private buildWeaponCards(weapons: WeaponInfo[], centerX: number, _centerY: number): void {
    const cardWidth = 140;
    const cardHeight = 160;
    const cardSpacing = 12;
    const maxColumns = Math.min(weapons.length, 7);
    const columns = Math.min(weapons.length, maxColumns);
    const rows = Math.ceil(weapons.length / columns);

    const totalGridWidth = columns * cardWidth + (columns - 1) * cardSpacing;
    const totalGridHeight = rows * cardHeight + (rows - 1) * cardSpacing;
    const startX = centerX - totalGridWidth / 2 + cardWidth / 2;
    const startY = (this.scale.height / 2) - totalGridHeight / 2 + 20;

    weapons.forEach((weaponInfo, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cardX = startX + column * (cardWidth + cardSpacing);
      const cardY = startY + row * (cardHeight + cardSpacing);

      this.createWeaponCard(weaponInfo, cardX, cardY, cardWidth, cardHeight, index + 1);
    });
  }

  /**
   * Apply focused visual state to a weapon card.
   */
  private focusWeaponCard(cardRef: WeaponCardRef): void {
    cardRef.cardBackground.setFillStyle(0x2a2a4e, 0.9);
    cardRef.cardBackground.setStrokeStyle(2, 0xffdd44);
    cardRef.nameText.setColor('#ffdd44');
    const iconBaseScale = 40 / 64;
    cardRef.iconSprite.setScale(iconBaseScale * 1.1);
  }

  /**
   * Apply default (unfocused) visual state to a weapon card.
   */
  private blurWeaponCard(cardRef: WeaponCardRef): void {
    cardRef.cardBackground.setFillStyle(0x1a1a2e, 0.8);
    cardRef.cardBackground.setStrokeStyle(1, 0x333355);
    cardRef.nameText.setColor('#ffffff');
    const iconBaseScale = 40 / 64;
    cardRef.iconSprite.setScale(iconBaseScale);
  }

  /**
   * Create a single weapon selection card.
   */
  private createWeaponCard(
    weaponInfo: WeaponInfo,
    x: number,
    y: number,
    width: number,
    height: number,
    keyNumber: number,
  ): void {
    // Card background
    const cardBackground = this.add.rectangle(x, y, width, height, 0x1a1a2e, 0.8);
    cardBackground.setStrokeStyle(1, 0x333355);
    cardBackground.setInteractive({ useHandCursor: true });

    // Weapon icon
    const iconSprite = createIcon(this, {
      x,
      y: y - 35,
      iconKey: weaponInfo.icon,
      size: 40,
      tint: 0xffffff,
    });

    // Weapon name
    const nameText = this.add.text(x, y + 10, weaponInfo.name, {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: width - 16 },
    }).setOrigin(0.5);

    // Short description
    this.add.text(x, y + 35, weaponInfo.description, {
      fontSize: '10px',
      color: '#8888aa',
      fontFamily: 'Arial',
      align: 'center',
      wordWrap: { width: width - 12 },
    }).setOrigin(0.5);

    // Key hint
    if (keyNumber <= 9) {
      this.add.text(x, y + height / 2 - 12, `[${keyNumber}]`, {
        fontSize: '11px',
        color: '#555577',
        fontFamily: 'Arial',
      }).setOrigin(0.5);
    }

    // Store card reference for MenuNavigator
    const cardRef: WeaponCardRef = { cardBackground, nameText, iconSprite, weaponId: weaponInfo.id };
    this.weaponCardRefs.push(cardRef);

    // Hover effects
    cardBackground.on('pointerover', () => {
      this.soundManager.playUIClick();
      this.focusWeaponCard(cardRef);
      // Sync navigator index with pointer hover
      const cardIndex = this.weaponCardRefs.indexOf(cardRef);
      if (cardIndex >= 0 && this.menuNavigator) {
        // Use selectIndex to keep navigator in sync without re-triggering focus
        // We manually focused above, so just update internal state
        this.menuNavigator.selectIndex(cardIndex);
      }
    });

    cardBackground.on('pointerout', () => {
      this.blurWeaponCard(cardRef);
    });

    // Select on click
    cardBackground.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.selectWeapon(weaponInfo.id);
    });
  }

  /**
   * Transition to GameScene with the selected starting weapon.
   */
  private selectWeapon(weaponId: string): void {
    // Prevent double-selection
    this.input.keyboard?.removeAllListeners();
    this.input.removeAllListeners();

    const selectedModifiers = selectRunModifiers(2);
    fadeOut(this, 150, () => {
      this.scene.start('GameScene', {
        restore: false,
        startingWeapon: weaponId,
        modifierIds: selectedModifiers.map(m => m.id),
      });
    });
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    this.input.keyboard?.removeAllListeners();
    this.tweens.killAll();
  }
}
