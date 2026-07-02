/**
 * MenuStyle — shared design tokens for the sleek neon-tech UI.
 *
 * Sharp, flat, clean: squared-off technical display type, thin accent
 * borders, no tilt, no cartoon shadows. Every menu scene reads from this
 * module so role-coding (gold for daily/shop, magenta for codex/weekly,
 * cyan for primary, teal for achievements) stays consistent across the game.
 */

/** Body copy — high-legibility humanist sans. */
export const MENU_FONT = '"Atkinson Hyperlegible", Arial, sans-serif';

/** Display face — sharp, semi-condensed technical sans for headings/labels. */
export const DISPLAY_FONT = '"Rajdhani", "Atkinson Hyperlegible", Arial, sans-serif';

export const MENU_COLORS = {
  // Heading/label colors — cool whites, no cream.
  headingWhite: '#f2f6ff',
  headingGold: '#ffd94a',
  outline: '#050810',

  // Body fill (deep saturated tints)
  bodyPrimary: 0x1c2a4a,
  bodyGold: 0x3a2810,
  bodyMagenta: 0x2a1838,
  bodyTeal: 0x12303a,
  bodyNeutral: 0x141a28,
  bodyDanger: 0x3a1620,
  bodySafe: 0x152e22,

  // Accent banner colors
  accentPrimary: 0x66bbff,
  accentPrimaryStr: '#66bbff',
  accentGold: 0xffcc44,
  accentGoldStr: '#ffcc44',
  accentMagenta: 0xcc66ff,
  accentMagentaStr: '#cc88ff',
  accentTeal: 0x66ddcc,
  accentTealStr: '#66ddcc',
  accentFocus: 0xffdd44,
  accentFocusStr: '#ffdd44',
  accentDanger: 0xff5566,
  accentDangerStr: '#ff5566',
  accentSafe: 0x66dd88,
  accentSafeStr: '#66dd88',
  accentNeutral: 0x8898b0,
  accentNeutralStr: '#8898b0',

  // Body text (light on dark cards)
  textBody: '#e8ecf4',
  textMuted: '#a0a8b8',
  textDim: '#7a8090',

  danger: '#ff5566',
  safe: '#66dd88',
} as const;

/** Indexed by semantic role used across upgrade categories, shop tabs, etc. */
export const BODY_COLORS = {
  primary: MENU_COLORS.bodyPrimary,
  gold: MENU_COLORS.bodyGold,
  magenta: MENU_COLORS.bodyMagenta,
  teal: MENU_COLORS.bodyTeal,
  neutral: MENU_COLORS.bodyNeutral,
  danger: MENU_COLORS.bodyDanger,
  safe: MENU_COLORS.bodySafe,
} as const;

export const ACCENT_COLORS = {
  primary: MENU_COLORS.accentPrimary,
  gold: MENU_COLORS.accentGold,
  magenta: MENU_COLORS.accentMagenta,
  teal: MENU_COLORS.accentTeal,
  focus: MENU_COLORS.accentFocus,
  danger: MENU_COLORS.accentDanger,
  safe: MENU_COLORS.accentSafe,
  neutral: MENU_COLORS.accentNeutral,
} as const;

export const ACCENT_COLORS_STR = {
  primary: MENU_COLORS.accentPrimaryStr,
  gold: MENU_COLORS.accentGoldStr,
  magenta: MENU_COLORS.accentMagentaStr,
  teal: MENU_COLORS.accentTealStr,
  focus: MENU_COLORS.accentFocusStr,
  danger: MENU_COLORS.accentDangerStr,
  safe: MENU_COLORS.accentSafeStr,
  neutral: MENU_COLORS.accentNeutralStr,
} as const;

export const TEXT_COLORS = {
  body: MENU_COLORS.textBody,
  muted: MENU_COLORS.textMuted,
  dim: MENU_COLORS.textDim,
  heading: MENU_COLORS.headingWhite,
  headingGold: MENU_COLORS.headingGold,
  danger: MENU_COLORS.danger,
  safe: MENU_COLORS.safe,
} as const;

export type RoleColorKey = keyof typeof BODY_COLORS;

/** Body+accent pair for a semantic role. */
export function roleColors(role: RoleColorKey): { body: number; accent: number; accentStr: string } {
  switch (role) {
    case 'primary':
      return { body: BODY_COLORS.primary, accent: ACCENT_COLORS.primary, accentStr: ACCENT_COLORS_STR.primary };
    case 'gold':
      return { body: BODY_COLORS.gold, accent: ACCENT_COLORS.gold, accentStr: ACCENT_COLORS_STR.gold };
    case 'magenta':
      return { body: BODY_COLORS.magenta, accent: ACCENT_COLORS.magenta, accentStr: ACCENT_COLORS_STR.magenta };
    case 'teal':
      return { body: BODY_COLORS.teal, accent: ACCENT_COLORS.teal, accentStr: ACCENT_COLORS_STR.teal };
    case 'danger':
      return { body: BODY_COLORS.danger, accent: ACCENT_COLORS.danger, accentStr: ACCENT_COLORS_STR.danger };
    case 'safe':
      return { body: BODY_COLORS.safe, accent: ACCENT_COLORS.safe, accentStr: ACCENT_COLORS_STR.safe };
    case 'neutral':
    default:
      return { body: BODY_COLORS.neutral, accent: ACCENT_COLORS.neutral, accentStr: ACCENT_COLORS_STR.neutral };
  }
}
