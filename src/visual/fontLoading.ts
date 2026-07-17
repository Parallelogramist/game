/**
 * Webfont preloading.
 *
 * Almost every string in this game is drawn to the Phaser canvas, and a canvas
 * draw never triggers an @font-face download — the face has to be requested
 * explicitly, or the text silently renders in the fallback (Arial). Phaser then
 * caches each text texture on first draw, so a face that arrives after boot
 * never reaches the pixels either. Both together are why this has to run to
 * completion before `new Phaser.Game(...)` is constructed.
 */

/** Structural slice of `FontFaceSet` — keeps the node-environment suite DOM-free. */
export interface FontLoaderLike {
  load(font: string): Promise<unknown>;
}

/**
 * The five faces declared in index.html, as CSS `font` shorthand. The size is
 * irrelevant to which file is fetched — only family and weight select the face.
 */
export const GAME_FONT_FACES: readonly string[] = [
  '500 16px "Rajdhani"',
  '600 16px "Rajdhani"',
  '700 16px "Rajdhani"',
  '400 16px "Atkinson Hyperlegible"',
  '700 16px "Atkinson Hyperlegible"',
];

/** A stalled font fetch must never hold the game hostage; boot in Arial instead. */
export const FONT_LOAD_TIMEOUT_MS = 3000;

export async function loadGameFonts(
  loader: FontLoaderLike | undefined,
  timeoutMs: number = FONT_LOAD_TIMEOUT_MS,
): Promise<void> {
  if (!loader || typeof loader.load !== 'function') return;

  const allFaces = Promise.all(
    GAME_FONT_FACES.map((face) =>
      loader.load(face).catch((error) => {
        console.warn(`[fonts] could not load ${face}`, error);
      }),
    ),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  try {
    await Promise.race([allFaces, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
