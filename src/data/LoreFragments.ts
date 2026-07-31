/**
 * Lore fragments: the carrier for hint tier 2 (doc 04 section 5).
 *
 * The prose here is flavour and deliberately names no place. The location half of a hint is
 * generated from the player's own world by src/expedition/secretHints.ts, so a fragment can
 * never claim something the world does not contain.
 *
 * Pure data, the FieldBoosts.ts shape. Doc 04 section 8 lists this catalog under a
 * `Secrets.ts` row alongside SecretDefinition fields; those fields all found homes elsewhere
 * (placement is the generator's, payout is secretRewards.ts's, found-state is the discovery
 * store's), so what is left is the fragments, and the file is named for them.
 */

export interface LoreFragmentDefinition {
  readonly id: string;
  /** At or under 17 characters: a toast title does not wrap. */
  readonly title: string;
  /** One line of flavour, shown above the generated riddle. Names no place, ever. */
  readonly text: string;
  /** ICON_MAP key, asserted by referentialIntegrity.test.ts. */
  readonly icon: string;
}

export const LORE_FRAGMENTS: readonly LoreFragmentDefinition[] = [
  {
    id: 'lore_tallyman_slate',
    title: "Tallyman's Slate",
    text: 'Scratched tally marks, then one line: nine buried, three recovered, the rest keep.',
    icon: 'book',
  },
  {
    id: 'lore_burnt_manifest',
    title: 'Burnt Manifest',
    text: 'A cargo list with charred edges. Every line but one is struck through.',
    icon: 'book',
  },
  {
    id: 'lore_last_signal',
    title: 'Last Transmission',
    text: 'I told them the vault was empty. It was not. Do not come back for me.',
    icon: 'book',
  },
  {
    id: 'lore_survey_pin',
    title: 'Survey Pin',
    text: "A prospector's marker pin, still warm, still humming its claim frequency.",
    icon: 'book',
  },
  {
    id: 'lore_voidmason_note',
    title: "Voidmason's Note",
    text: 'A wall is only a door nobody has argued with yet.',
    icon: 'book',
  },
  {
    id: 'lore_ration_ledger',
    title: 'Ration Ledger',
    text: 'Someone counted days on this page, stopped counting, and started drawing maps.',
    icon: 'book',
  },
  {
    id: 'lore_broken_beacon',
    title: 'Broken Beacon',
    text: 'A distress beacon taken apart from the inside. Whoever it called never left.',
    icon: 'book',
  },
  {
    id: 'lore_pilots_wager',
    title: "Pilot's Wager",
    text: 'Two names, one bet, and a course plotted somewhere nobody sane flies.',
    icon: 'book',
  },
];
