/**
 * CreditsScene - Displays game credits and attributions.
 * Uses a two-column layout to fit all content on screen.
 */

import Phaser from 'phaser';

export class CreditsScene extends Phaser.Scene {
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor() {
    super({ key: 'CreditsScene' });
  }

  create(): void {
    const centerX = this.cameras.main.centerX;
    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;

    // Title
    this.add
      .text(centerX, 50, 'CREDITS', {
        fontSize: '42px',
        color: '#ffdd44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Define column positions (2 columns)
    const leftColumnX = screenWidth * 0.35;
    const rightColumnX = screenWidth * 0.65;
    const contentStartY = 130;
    const lineHeight = 28;
    const sectionGap = 20;

    // Helper to add section header
    const addHeader = (x: number, y: number, text: string): number => {
      this.add
        .text(x, y, text, {
          fontSize: '18px',
          color: '#ffdd44',
          fontFamily: 'Arial',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      return y + lineHeight;
    };

    // Helper to add content line
    const addLine = (x: number, y: number, text: string, color: string = '#ffffff'): number => {
      this.add
        .text(x, y, text, {
          fontSize: '14px',
          color: color,
          fontFamily: 'Arial',
        })
        .setOrigin(0.5);
      return y + lineHeight - 4;
    };

    // LEFT COLUMN - Developer & Built With
    let leftY = contentStartY;

    leftY = addHeader(leftColumnX, leftY, 'DEVELOPED BY');
    leftY = addLine(leftColumnX, leftY, 'George');
    leftY += sectionGap;

    leftY = addHeader(leftColumnX, leftY, 'BUILT WITH');
    leftY = addLine(leftColumnX, leftY, 'Phaser 3');
    leftY = addLine(leftColumnX, leftY, 'Game Framework', '#888888');
    leftY += 10;
    leftY = addLine(leftColumnX, leftY, 'bitECS');
    leftY = addLine(leftColumnX, leftY, 'Entity Component System', '#888888');

    // RIGHT COLUMN - Sound Effects & Icons
    let rightY = contentStartY;

    rightY = addHeader(rightColumnX, rightY, 'SOUND EFFECTS');
    rightY = addLine(rightColumnX, rightY, 'Kenney.nl');
    rightY = addLine(rightColumnX, rightY, 'CC0 License', '#888888');
    rightY += sectionGap;

    rightY = addHeader(rightColumnX, rightY, 'ICONS');
    rightY = addLine(rightColumnX, rightY, 'game-icons.net');
    rightY = addLine(rightColumnX, rightY, 'CC BY 3.0', '#888888');

    // Decorative separator line
    const separatorY = screenHeight - 100;
    const separatorGraphics = this.add.graphics();
    separatorGraphics.lineStyle(1, 0x444444);
    separatorGraphics.lineBetween(screenWidth * 0.2, separatorY, screenWidth * 0.8, separatorY);

    // Back button
    const backButton = this.add
      .text(centerX, screenHeight - 60, '[ Back ]', {
        fontSize: '20px',
        color: '#ffdd44',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backButton.on('pointerover', () => backButton.setColor('#ffffff'));
    backButton.on('pointerout', () => backButton.setColor('#ffdd44'));
    backButton.on('pointerdown', () => {
      this.returnToMenu();
    });

    // Keyboard handler for ESC, Enter, Space
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        this.returnToMenu();
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);
  }

  /**
   * Returns to the main menu.
   */
  private returnToMenu(): void {
    this.scene.start('BootScene');
  }

  /**
   * Cleanup keyboard handlers when scene shuts down.
   */
  shutdown(): void {
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
}
