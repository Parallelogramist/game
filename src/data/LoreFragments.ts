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
  {
    id: 'lore_ferryman_toll',
    title: "Ferryman's Toll",
    text: 'Payment taken, passage granted. The return leg was never part of the price.',
    icon: 'coins',
  },
  {
    id: 'lore_quarantine_tag',
    title: 'Quarantine Tag',
    text: 'Sealed by order of a station that stopped answering the year this was printed.',
    icon: 'warning',
  },
  {
    id: 'lore_ghost_roster',
    title: 'Ghost Roster',
    text: 'A crew list where every name is struck out and rewritten in the same hand.',
    icon: 'ghost',
  },
  {
    id: 'lore_starving_chart',
    title: 'Starving Chart',
    text: 'A chart annotated by a shaking hand: this one is wrong, this one lies, this one is home.',
    icon: 'radar',
  },
  {
    id: 'lore_hull_epitaph',
    title: 'Hull Epitaph',
    text: 'Twelve names welded into a plate, with room left for a thirteenth.',
    icon: 'skull',
  },
  {
    id: 'lore_debtors_chit',
    title: "Debtor's Chit",
    text: 'A promissory note for one salvage share, countersigned by a hand that shakes.',
    icon: 'coins',
  },
  {
    id: 'lore_sealed_writ',
    title: 'Sealed Writ',
    text: 'An order to open nothing, signed by three officers who each blamed the others.',
    icon: 'clipboard',
  },
  {
    id: 'lore_mappers_oath',
    title: "Mapper's Oath",
    text: 'I will draw what is there. I will not draw what I wish were there.',
    icon: 'radar',
  },
  {
    id: 'lore_dead_reckoning',
    title: 'Dead Reckoning',
    text: 'Three courses plotted from one position, and none of them agree on where here is.',
    icon: 'telescope',
  },
  {
    id: 'lore_widows_lens',
    title: "Widow's Lens",
    text: 'A cracked optic, polished smooth on one side by a thumb that waited a long time.',
    icon: 'eye',
  },
  {
    id: 'lore_scavengers_creed',
    title: 'Scavenger Creed',
    text: "Take the small thing first. The big thing is bait, and it is always somebody's.",
    icon: 'backpack',
  },
  {
    id: 'lore_torn_confession',
    title: 'Torn Confession',
    text: 'The bottom half is missing. The top half apologises to someone by rank, never by name.',
    icon: 'book',
  },
  {
    id: 'lore_counterfeit_key',
    title: 'Counterfeit Key',
    text: 'Cut to fit a lock that was never installed, by someone who charged for the pair.',
    icon: 'gear',
  },
  {
    id: 'lore_unpaid_tab',
    title: 'Unpaid Tab',
    text: 'A running balance in two hands, one careful, one furious, and never settled.',
    icon: 'coins',
  },
  {
    id: 'lore_salvage_lottery',
    title: 'Salvage Lottery',
    text: 'Nine tickets drawn, nine holds opened, one crew still arguing about the tenth.',
    icon: 'dice',
  },
  {
    id: 'lore_lamplighter_log',
    title: 'Lamplighter Log',
    text: 'Every entry is the same: lit it again, it went out again, something is drinking it.',
    icon: 'sunbeam',
  },
  {
    id: 'lore_frozen_watch',
    title: 'Frozen Watch',
    text: 'A timepiece stopped at the moment its owner decided a wall was worth arguing with.',
    icon: 'clock',
  },
  {
    id: 'lore_heirloom_bolt',
    title: 'Heirloom Bolt',
    text: 'A single fastener, passed down four crews, holding nothing and worth everything.',
    icon: 'bolt',
  },
];
