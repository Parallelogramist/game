/**
 * The game-over overlay's expedition row: the one stat row that names the world a death
 * happened in. Pure so the label grammar can be pinned without a scene, on the
 * victoryKicker.ts model — the overlay draws nothing but what this returns.
 */

export interface ExpeditionDebrief {
  /** The world's season index — the same `W<n>` the CHART tile and the banked rows print. */
  seasonIndex: number;
  /** Whole-percent completion of THIS world at the moment the run ended. */
  completionPercent: number;
  /** Sectors visited in this world, lifetime across every run in it. */
  sectorsCharted: number;
  /** Sectors the profile is allowed to know exist right now (the completion denominator). */
  knowableSectors: number;
  /**
   * Sectors charted during THIS run. Null on a reload-restored run, which lost its
   * run-start baseline with the page, same rule as the pace curve and the run timeline.
   */
  chartedThisRun: number | null;
}

export interface ExpeditionDebriefRow {
  /** Left cell value: `W3 · 42%`. */
  worldLabel: string;
  /** Right cell value: `18 / 43 (+4)`. */
  chartedLabel: string;
}

export function buildExpeditionDebriefRow(debrief: ExpeditionDebrief): ExpeditionDebriefRow {
  const { seasonIndex, completionPercent, sectorsCharted, knowableSectors, chartedThisRun } = debrief;
  // A zero denominator means the world never bound; printing `18 / 0` would be a lie
  // rather than a number, so the count stands alone.
  const charted = knowableSectors > 0
    ? `${sectorsCharted} / ${knowableSectors}`
    : `${sectorsCharted}`;
  const delta = chartedThisRun !== null && chartedThisRun > 0 ? ` (+${chartedThisRun})` : '';
  return {
    worldLabel: `W${seasonIndex} · ${completionPercent}%`,
    chartedLabel: `${charted}${delta}`,
  };
}
