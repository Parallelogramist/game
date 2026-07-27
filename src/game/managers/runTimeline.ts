/**
 * Pure layout for the run-end RUN TIMELINE ribbon. The clustering rule lives here
 * rather than in the scene so the part that decides what forty level-ups look like
 * on a 1160 px track is testable without a Phaser scene.
 *
 * Named `RunTimelineEvent`, not `RunEvent`: `systems/EventSystem` already exports
 * `RunEvent` and GameScene imports it.
 */

export type RunTimelineEventKind =
  | 'level'
  | 'ultimate'
  | 'miniboss'
  | 'boss'
  | 'bossDown'
  | 'closeCall';

export interface RunTimelineEvent {
  kind: RunTimelineEventKind;
  /** Seconds into the run when the beat happened. */
  atSeconds: number;
}

export interface RunTimelineMarker {
  kind: RunTimelineEventKind;
  /** Pixels from the track's left edge. */
  offsetX: number;
  /** How many events this marker collapsed (1 when it stands alone). */
  count: number;
}

/** Two markers of the same kind closer together than this collapse into one. */
export const TIMELINE_MIN_SPACING_PX = 6;

/** Per-run recording cap. A 20-minute run logs well under this; it bounds a pathological one. */
export const RUN_TIMELINE_EVENT_CAP = 400;

/** Draw order, tie-break order, and legend order, all at once. */
export const TIMELINE_KIND_ORDER: RunTimelineEventKind[] = [
  'level',
  'ultimate',
  'miniboss',
  'boss',
  'bossDown',
  'closeCall',
];

/**
 * Places each beat on a track `trackWidth` px wide, collapsing same-kind beats that
 * would land within `minSpacingPx` of each other into one marker carrying the count.
 * Kinds never collapse into each other, so a boss killed at the same second the
 * player levelled stays two markers.
 */
export function layoutRunTimeline(
  events: RunTimelineEvent[],
  runSeconds: number,
  trackWidth: number,
  minSpacingPx: number = TIMELINE_MIN_SPACING_PX,
): RunTimelineMarker[] {
  if (trackWidth <= 0 || events.length === 0) return [];

  const markers: RunTimelineMarker[] = [];

  for (const kind of TIMELINE_KIND_ORDER) {
    const eventsOfKind = events
      .filter((event) => event.kind === kind)
      .sort((firstEvent, secondEvent) => firstEvent.atSeconds - secondEvent.atSeconds);

    let openMarker: RunTimelineMarker | null = null;
    for (const event of eventsOfKind) {
      const runProgress = runSeconds > 0
        ? Math.min(1, Math.max(0, event.atSeconds / runSeconds))
        : 0;
      const offsetX = Math.round(trackWidth * runProgress);

      if (openMarker !== null && offsetX - openMarker.offsetX < minSpacingPx) {
        openMarker.count += 1;
        continue;
      }

      openMarker = { kind, offsetX, count: 1 };
      markers.push(openMarker);
    }
  }

  return markers.sort(
    (firstMarker, secondMarker) =>
      firstMarker.offsetX - secondMarker.offsetX ||
      TIMELINE_KIND_ORDER.indexOf(firstMarker.kind) - TIMELINE_KIND_ORDER.indexOf(secondMarker.kind),
  );
}
