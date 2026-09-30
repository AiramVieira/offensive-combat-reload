// Weapon data schema (section 7 of the design doc). Loaded by client and, later, the server.
import riflePadrao from './data/weapons/rifle_padrao.json';
import faca from './data/weapons/faca.json';
import granadaFrag from './data/weapons/granada_frag.json';

/** 'virilha' is the groin zone: any hit there is an instant kill ("No pássaro!"). */
export type HitRegion = 'cabeca' | 'tronco' | 'bracos' | 'pernas' | 'virilha';
export type BodyRegion = Exclude<HitRegion, 'virilha'>;

/** Regions that kill instantly regardless of weapon damage. */
export const INSTANT_KILL_REGIONS: ReadonlySet<HitRegion> = new Set(['virilha']);
export const LETHAL_DAMAGE = 9999;

export interface WeaponData {
  id: string;
  nome: string;
  categoria: string;
  slot: 'primaria' | 'secundaria' | 'corpo';
  dano: { max: number; min: number; distMax: number; distMin: number };
  multiplicadores: Record<BodyRegion, number>;
  /** Rounds per minute. */
  cadencia: number;
  modo: 'auto' | 'semi' | 'rajada';
  pente: number;
  reserva: number;
  /** Seconds. "tatica" = mag not empty, "vazia" = empty mag (needs chambering). */
  recarga: { tatica: number; vazia: number };
  /** Cone half-angles in degrees; porTiro is added per shot, decaimento is degrees/s of recovery. */
  dispersao: { mirando: number; parado: number; andando: number; noAr: number; porTiro: number; decaimento: number };
  /** Degrees per shot; retorno is the exponential recovery rate (1/s). */
  recuo: { vertical: number; horizontal: [number, number]; retorno: number };
  ads: { tempo: number; zoom: number };
  movimento: number;
  alcanceMaximo: number;
  /** Which surfaces the bullet goes through. Absent = stops at the first surface. */
  penetracao?: PenetrationData;
  tracanteACada: number;
  desbloqueioNivel: number;
  preco: { moedaJogo: number; premium: number };
  slotsAcessorio: string[];
  modelo: string;
  sons: Record<string, string>;
}

/**
 * Bullet penetration: the shot continues through thin surfaces of these physics materials (wood fences,
 * doors and walls, glass), keeping `dano` of its damage per surface crossed. Thicker than `espessuraMax`
 * along the bullet's path (a crate, or a thin board hit at a grazing angle) stops it.
 */
export interface PenetrationData {
  /** Surfaces a single bullet can cross. */
  maxSuperficies: number;
  /** Keyed by physics material ("wood", "glass", ...). */
  materiais: Record<string, { dano: number; espessuraMax: number }>;
}

/** The lowest damage fraction a bullet of this weapon can arrive with (server-side sanity bound). */
export function minPenetrationKeep(w: WeaponData): number {
  const p = w.penetracao;
  if (!p) return 1;
  const worst = Math.min(1, ...Object.values(p.materiais).map((m) => m.dano));
  return worst ** p.maxSuperficies;
}

/** Melee weapon (section 6). In the original, a knife hit is always a one-hit kill. */
export interface MeleeData {
  id: string;
  nome: string;
  letal: boolean;
  /** Hit range in meters, from the eye to the target's body surface. */
  alcance: number;
  /** Targets up to this distance pull the player in with a lunge. */
  alcanceInvestida: number;
  /** Max horizontal angle between the view and the target. */
  anguloGraus: number;
  /** Total swing animation, seconds. */
  duracao: number;
  /** Time into the swing when the hit resolves. */
  impacto: number;
  /** Minimum time between swings. */
  intervalo: number;
  velocidadeInvestida: number;
}

/** One upgrade level of a grenade. Progression (which level a player has) is decided later. */
export interface GrenadeLevel {
  nivel: number;
  /** Nothing beyond this distance (m) takes damage. */
  raioDano: number;
  /** Full damage inside this distance (m); linear falloff to danoMin at raioDano. */
  raioDanoMaximo: number;
  danoMax: number;
  danoMin: number;
  /** false = the explosion never takes another player below 1 HP (the thrower is never protected). */
  podeMatar: boolean;
}

/** Thrown explosive (section 6): cookable fuse, physical projectile, area damage blocked by walls. */
export interface GrenadeData {
  id: string;
  nome: string;
  /** Carried per life. */
  quantidade: number;
  /** Offline prototype convenience: seconds to get one grenade back (0 = only on respawn). */
  recargaSegundos: number;
  /** Seconds from pulling the pin to the explosion (holding G cooks it). */
  pavio: number;
  /** A tap still plays the pin-pull animation for at least this long before the throw. */
  tempoMinimoPuxar: number;
  velocidadeLancamento: number;
  /** Throw speed multiplier when thrown in the air (jump + throw goes farther). */
  bonusPulo: number;
  /**
   * true = once thrown, the fuse no longer matters: it goes off on the first contact with anything (floor,
   * wall, a character's hitbox). The fuse still runs while cooking in the hand.
   */
  impacto: boolean;
  /** Impact grenades that never touch anything (thrown out of the map) go off after this many seconds. */
  tempoMaximoVoo: number;
  /** Throws aim slightly above the crosshair so a level throw arcs naturally. */
  anguloExtraGraus: number;
  intervalo: number;
  /** Collision radius (m), bounciness and friction of the projectile. */
  raio: number;
  quique: number;
  atrito: number;
  niveis: GrenadeLevel[];
}

export const WEAPONS: Record<string, WeaponData> = {
  rifle_padrao: riflePadrao as unknown as WeaponData,
};

export const MELEE: Record<string, MeleeData> = {
  faca: faca as MeleeData,
};

export const GRENADES: Record<string, GrenadeData> = {
  granada_frag: granadaFrag as GrenadeData,
};

export function grenadeLevel(g: GrenadeData, level: number): GrenadeLevel {
  return g.niveis.find((n) => n.nivel === level) ?? g.niveis[0];
}

/** Explosion damage at `dist` meters before the lethality rule; 0 outside the radius. */
export function explosionDamage(l: GrenadeLevel, dist: number): number {
  if (dist > l.raioDano) return 0;
  if (dist <= l.raioDanoMaximo) return l.danoMax;
  const t = (dist - l.raioDanoMaximo) / (l.raioDano - l.raioDanoMaximo);
  return Math.round(l.danoMax + (l.danoMin - l.danoMax) * t);
}

/** Applies the level's lethality rule: a non-lethal grenade leaves the target on at least 1 HP. */
export function clampExplosionDamage(l: GrenadeLevel, damage: number, targetHealth: number): number {
  return l.podeMatar ? damage : Math.max(0, Math.min(damage, Math.ceil(targetHealth) - 1));
}

/** Damage after linear range falloff between distMax and distMin, before the body-region multiplier. */
export function damageAtDistance(w: WeaponData, dist: number): number {
  const { max, min, distMax, distMin } = w.dano;
  if (dist <= distMax) return max;
  if (dist >= distMin) return min;
  const t = (dist - distMax) / (distMin - distMax);
  return max + (min - max) * t;
}

/**
 * `keep` is the damage fraction left after going through surfaces (1 = clean hit). A groin hit kills
 * no matter what the bullet went through.
 */
export function computeDamage(w: WeaponData, dist: number, region: HitRegion, keep = 1): number {
  if (region === 'virilha' || INSTANT_KILL_REGIONS.has(region)) return LETHAL_DAMAGE;
  return Math.max(1, Math.round(damageAtDistance(w, dist) * w.multiplicadores[region] * keep));
}

/** Time-to-kill against 100 HP at max damage (design doc formula). */
export function idealTtk(w: WeaponData, perShot = w.dano.max): number {
  return (Math.ceil(100 / perShot) - 1) * (60 / w.cadencia);
}
