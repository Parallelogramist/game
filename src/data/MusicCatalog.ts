/**
 * MusicCatalog - Track definitions for all available BGM.
 * Contains metadata for the XM tracker music files.
 */

export interface Track {
  id: string;
  filename: string;
  title: string;
}

/**
 * All available music tracks in the game.
 * Files are located in /public/music/
 */
export const MUSIC_CATALOG: Track[] = [
  {
    id: 'brd-teleport',
    filename: 'teleport-pro.xm',
    title: 'Track 1',
  },
  {
    id: 'brd-dvdfab',
    filename: 'brd-dvdfab.xm',
    title: 'Track 2',
  },
  {
    id: 'brd-xilisoft',
    filename: 'brd-xilisoft.xm',
    title: 'Track 3',
  },
  {
    id: 'paradox-nero',
    filename: 'paradox-nero.xm',
    title: 'Track 4',
  },
  {
    id: 'paradox-photoshop',
    filename: 'paradox-photoshop.xm',
    title: 'Track 5',
  },
  {
    id: 'razor-battlefield',
    filename: 'razor-battlefield.xm',
    title: 'Track 6',
  },
  {
    id: 'razor-crysis',
    filename: 'razor-crysis.xm',
    title: 'Track 7',
  },
  {
    id: 'razor-gta4',
    filename: 'razor-gta4.xm',
    title: 'Track 8',
  },
  {
    id: 'razor-halflife',
    filename: 'razor-halflife.xm',
    title: 'Track 9',
  },
  {
    id: 'razor-quake3',
    filename: 'razor-quake3.xm',
    title: 'Track 10',
  },
  {
    id: 'razor-settlers',
    filename: 'razor-settlers.xm',
    title: 'Track 11',
  },
  {
    id: 'razor-starcraft2',
    filename: 'razor-starcraft2.xm',
    title: 'Track 12',
  },
  {
    id: 'deviance-cod2',
    filename: 'deviance-cod2.xm',
    title: 'Track 13',
  },
  {
    id: 'deviance-fable',
    filename: 'deviance-fable.xm',
    title: 'Track 14',
  },
  {
    id: 'deviance-mechwarrior',
    filename: 'deviance-mechwarrior.xm',
    title: 'Track 15',
  },
  {
    id: 'deviance-seriossam',
    filename: 'deviance-seriossam.xm',
    title: 'Track 16',
  },
  {
    id: 'deviance-xmen',
    filename: 'deviance-xmen.xm',
    title: 'Track 17',
  },
  {
    id: 'core-adobe',
    filename: 'core-adobe.xm',
    title: 'Track 18',
  },
  {
    id: 'core-dreamweaver',
    filename: 'core-dreamweaver.xm',
    title: 'Track 19',
  },
  {
    id: 'virility-ashampoo',
    filename: 'virility-ashampoo.xm',
    title: 'Track 20',
  },
  {
    id: 'virility-divx',
    filename: 'virility-divx.xm',
    title: 'Track 21',
  },
  {
    id: 'virility-reaper',
    filename: 'virility-reaper.xm',
    title: 'Track 22',
  },
  {
    id: 'class-corvette',
    filename: 'class-corvette.xm',
    title: 'Track 23',
  },
  {
    id: 'class-colinmcrae',
    filename: 'class-colinmcrae.xm',
    title: 'Track 24',
  },
  {
    id: 'orion-flashmx',
    filename: 'orion-flashmx.xm',
    title: 'Track 25',
  },
  {
    id: 'orion-getright',
    filename: 'orion-getright.xm',
    title: 'Track 26',
  },
];

/**
 * Get track by ID.
 */
export function getTrackById(id: string): Track | undefined {
  return MUSIC_CATALOG.find((track) => track.id === id);
}

/**
 * Get the full path to a track file.
 */
export function getTrackPath(track: Track): string {
  return `music/${track.filename}`;
}
