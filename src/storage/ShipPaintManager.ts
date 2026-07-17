import { SecureStorage } from './SecureStorage';

const STORAGE_KEY_SHIP_PAINT = 'survivor-ship-paint';

export class ShipPaintManager {
  private selectedPaintId: string | null;

  constructor() {
    this.selectedPaintId = this.load();
  }

  /** The explicit choice, or null if the player has never chosen (auto-equip). */
  getSelectedPaintId(): string | null {
    return this.selectedPaintId;
  }

  setSelectedPaintId(paintId: string): void {
    this.selectedPaintId = paintId;
    try {
      SecureStorage.setItem(STORAGE_KEY_SHIP_PAINT, paintId);
    } catch {
      console.warn('ShipPaint: could not save selection');
    }
  }

  private load(): string | null {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_SHIP_PAINT);
      return stored && stored.length > 0 ? stored : null;
    } catch {
      console.warn('ShipPaint: could not load selection');
      return null;
    }
  }
}

let shipPaintManagerSingleton: ShipPaintManager | null = null;

export function getShipPaintManager(): ShipPaintManager {
  if (!shipPaintManagerSingleton) {
    shipPaintManagerSingleton = new ShipPaintManager();
  }
  return shipPaintManagerSingleton;
}
