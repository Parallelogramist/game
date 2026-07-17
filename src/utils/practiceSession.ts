/**
 * Practice-session flag.
 *
 * A practice run must leave zero trace: it hands out max-level weapons, so if it
 * could write, it would trip achievements, hidden unlocks and records against the
 * player's real profile. `SecureStorage` is the single write boundary every
 * manager persists through (see CLAUDE.md), so blocking writes while this flag is
 * set isolates the whole session in one place.
 *
 * Deliberately dependency-free: `src/storage/` imports it, and the vitest suite
 * runs in a DOM-free node environment.
 */

let practiceSessionActive = false;

export function setPracticeSession(active: boolean): void {
  practiceSessionActive = active;
}

export function isPracticeSession(): boolean {
  return practiceSessionActive;
}
