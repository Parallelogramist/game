import { describe, test, expect, vi } from 'vitest';
import { GAME_FONT_FACES, loadGameFonts } from './fontLoading';

describe('loadGameFonts', () => {
  test('requests every declared face', async () => {
    const load = vi.fn().mockResolvedValue([]);
    await loadGameFonts({ load });
    expect(load.mock.calls.map((call) => call[0])).toEqual([...GAME_FONT_FACES]);
  });

  test('resolves when a face fails to load — a missing font must never block boot', async () => {
    const load = vi.fn().mockRejectedValue(new Error('404'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(loadGameFonts({ load })).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });

  test('resolves on the timeout when a face never settles', async () => {
    const load = vi.fn(() => new Promise<void>(() => {}));
    await expect(loadGameFonts({ load }, 1)).resolves.toBeUndefined();
  });

  test('no-ops when the browser has no font loader', async () => {
    await expect(loadGameFonts(undefined)).resolves.toBeUndefined();
  });
});
