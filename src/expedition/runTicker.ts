/**
 * runTicker: the strings the one in-run HUD line rotates through while no bounty runs.
 *
 * Pure and Phaser-free like the rest of src/expedition/. Doc 04 section 4's rule is "one line,
 * never two": the bounty owns it while active and this module owns the idle branch, so it is
 * the single place that decides what may claim the line and in what order. A prefix names the
 * source, the way `BOUNTY ·` and `OBJECTIVE ·` already do, because the line keeps one colour:
 * setColor on a per-frame path forces a full text re-render, which 5a0295d settled.
 */

import type { QuestStepView } from '../systems/QuestProgress';
import type { SecretLead } from './secretHints';

/** The cycle advances one row every 5 s, so an uncapped lead list would push a three-objective
 *  round trip past half a minute. Two holds the worst case at five rows. */
export const MAX_TICKER_LEADS = 2;

/** A live siege as the line needs to read it. The caller owns the clock and the cap, so this
 *  module never sees gameTime and never learns where a besieger is counted. */
export interface RunTickerSiege {
  /** Besiegers this siege still has standing. */
  liveBesiegers: number;
  /** The ceiling that holds the next wave back until the room thins out. */
  maxBesiegers: number;
  /** Whole seconds until the next wave, already clamped at 0 by the caller. */
  secondsToNextWave: number;
  /** A boss owns the room, so no wave is coming while it lives. */
  suppressedByBoss: boolean;
}

export interface RunTickerInputs {
  /** Active quest steps, in the order the map screen's OBJECTIVES panel lists them. */
  views: readonly QuestStepView[];
  /** Quest ids whose objective moved and whose chart badge has not been looked at yet. Read
   *  only: MapScene.create owns the clear, so the two surfaces retire the badge together. */
  updatedQuestIds: ReadonlySet<string>;
  /** Open leads, nearest first. The caller sorts, so the ticker and the LEADS panel cannot
   *  disagree about which lead is closest. */
  leads: readonly SecretLead[];
  /** The live siege, or null while no room is answering. */
  siege?: RunTickerSiege | null;
}

/**
 * Objectives first, then leads: an objective is a directive and a lead is an invitation. An
 * empty result means the line renders empty, which is what a run with no objectives and no
 * open leads should say.
 *
 * A siege is neither. It is happening to the player right now, so it takes the first slot and
 * then every other one: one row in a cycle that can run half a minute long would be an
 * announcement, and what a siege needs is a standing tell.
 */
export function buildRunTickerRows(inputs: RunTickerInputs): string[] {
  const rows: string[] = [];
  for (const view of inputs.views) {
    const updatedSuffix = inputs.updatedQuestIds.has(view.questId) ? ' · UPDATED' : '';
    const note = view.note ? ` · ${view.note}` : '';
    rows.push(
      `OBJECTIVE · ${view.stepDescription} ${view.progress}/${view.target}${note}${updatedSuffix}`);
  }
  for (const lead of inputs.leads.slice(0, MAX_TICKER_LEADS)) {
    rows.push(`LEAD · ${lead.fragment.title.toUpperCase()} · ${lead.riddle}`);
  }
  const siege = inputs.siege ?? null;
  if (siege === null) return rows;
  const siegeLine = describeSiege(siege);
  if (rows.length === 0) return [siegeLine];
  const interleaved: string[] = [];
  for (const row of rows) {
    interleaved.push(siegeLine, row);
  }
  return interleaved;
}

/** The two reasons a wave is NOT coming outrank the countdown: a timer that runs to zero while
 *  nothing arrives is the one thing this line must not say. */
function describeSiege(siege: RunTickerSiege): string {
  if (siege.suppressedByBoss) return 'SIEGE · THE ROOM ANSWERS · HELD OFF WHILE THE BOSS LIVES';
  if (siege.liveBesiegers >= siege.maxBesiegers) {
    return `SIEGE · THE ROOM ANSWERS · ${siege.liveBesiegers} STILL STANDING`;
  }
  return `SIEGE · THE ROOM ANSWERS · NEXT WAVE ${siege.secondsToNextWave}S`;
}
