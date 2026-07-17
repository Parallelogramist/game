/**
 * Whether an enemy point lies within a beam segment anchored at (originX, originY),
 * oriented along the unit vector (cosAngle, sinAngle), of the given length and half-width.
 *
 * Pure geometry so it can be unit-tested without a Phaser scene — the same idiom as
 * sentryLogic / guardianLogic / wakeLogic. cos/sin are passed precomputed because the
 * caller reuses them across every enemy for a given spoke.
 */
export function isEnemyInBeam(
  enemyX: number,
  enemyY: number,
  originX: number,
  originY: number,
  cosAngle: number,
  sinAngle: number,
  length: number,
  halfWidth: number,
): boolean {
  const dx = enemyX - originX;
  const dy = enemyY - originY;
  // Projection onto the beam axis (how far along the beam the point sits).
  const along = dx * cosAngle + dy * sinAngle;
  if (along < 0 || along > length) return false;
  // Perpendicular distance from the axis.
  const perp = Math.abs(-dx * sinAngle + dy * cosAngle);
  return perp <= halfWidth;
}
