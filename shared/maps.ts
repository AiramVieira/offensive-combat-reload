// Maps a session, the training range or a bots match can be played on. The client builds the map from its
// id; the server only carries the id with each session so everyone in it loads the same one.
export const MAPS = {
  rua: { nome: 'Rua dos Vizinhos' },
  jardim: { nome: 'Jardim do Dragão' },
} as const;

export type MapId = keyof typeof MAPS;

export const MAP_IDS = Object.keys(MAPS) as MapId[];

export const DEFAULT_MAP: MapId = 'rua';

export const isMapId = (v: unknown): v is MapId => typeof v === 'string' && Object.hasOwn(MAPS, v);
