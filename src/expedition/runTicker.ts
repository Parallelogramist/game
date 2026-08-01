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

export interface RunTickerInputs {
  /** Active quest steps, in the order the map screen's OBJECTIVES panel lists them. */
  views: readonly QuestStepView[];
  /** Quest ids whose objective moved and whose chart badge has not been looked at yet. Read
   *  only: MapScene.create owns the clear, so the two surfaces retire the badge together. */
  updatedQuestIds: ReadonlySet<string>;
  /** Open leads, nearest first. The caller sorts, so the ticker and the LEADS panel cannot
   *  disagree about which lead is closest. */
  leads: readonly SecretLead[];
}

/**
 * Objectives first, then leads: an objective is a directive and a lead is an invitation. An
 * empty result means the line renders empty, which is what a run with no objectives and no
 * open leads should say.
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
  return rows;
}
