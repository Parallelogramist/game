/**
 * questBriefing: the lines the main menu's OBJECTIVES dialog renders.
 *
 * Pure and Phaser-free like the rest of src/expedition/, on the runTicker.ts model: the scene
 * reads the store and hands the rows over, and this module alone decides what the briefing says.
 * The fact it exists for is the one no in-run surface can carry: a sweep whose rooms were counted
 * in a world the profile is no longer flying is dropped when the next run binds, so the count the
 * store still holds is not the count that run will start from.
 */

import type { QuestStepView, WorldBoundStepProgress } from '../systems/QuestProgress';

export interface QuestBriefingInputs {
  /** The world the next run binds, as the `W<n>` every other menu surface prints. */
  seasonIndex: number;
  /** Whole-percent completion of that world. */
  completionPercent: number;
  /** `questWorldStamp` of the world the next run binds. */
  worldStamp: string;
  /** Active steps, exactly what the HUD ticker and the map's OBJECTIVES panel render. */
  views: readonly QuestStepView[];
  /** Every active sweep that has counted rooms, carrying the world it counted them in. */
  worldBound: readonly WorldBoundStepProgress[];
}

export function buildQuestBriefingLines(inputs: QuestBriefingInputs): string[] {
  const header = `WORLD ${inputs.seasonIndex}   ·   ${inputs.completionPercent}% CHARTED`;
  if (inputs.views.length === 0) {
    return [
      header,
      '',
      'No objectives are active.',
      'Three activate at a time as you fly, and every step',
      'they complete is kept across deaths.',
    ];
  }

  const roomsCountedElsewhere = new Map<string, number>();
  for (const row of inputs.worldBound) {
    if (row.worldStamp !== inputs.worldStamp) roomsCountedElsewhere.set(row.questId, row.roomsCounted);
  }

  const lines = [header, ''];
  for (const [index, view] of inputs.views.entries()) {
    if (index > 0) lines.push('');
    lines.push(`${view.questName}   ·   STEP ${view.stepNumber} OF ${view.stepCount}`);
    lines.push(`${view.stepDescription}   ${view.progress} / ${view.target}`);
    if (view.note !== undefined) lines.push(view.note);
    const stale = roomsCountedElsewhere.get(view.questId);
    if (stale !== undefined) {
      lines.push(stale === 1
        ? '1 room was charted in another world and restarts here.'
        : `${stale} rooms were charted in another world and restart here.`);
    }
  }
  return lines;
}
