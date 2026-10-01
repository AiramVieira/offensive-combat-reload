// Account level: its own XP (time alive online, kills, humiliations), apart from the weapons' points.
// Rules and curve live in data/nivel_conta.json.
import data from './data/nivel_conta.json';

export const ACCOUNT_XP = {
  perMinuteAlive: data.porMinutoVivo,
  perKill: data.porAbate,
  perHumiliation: data.porOpressao,
};

/** XP needed to go from level `n` to `n + 1`. */
export const levelCost = (n: number) => Math.round(data.base * Math.pow(n, data.expoente));

export interface AccountLevel {
  level: number;
  /** XP earned inside the current level, and what the next level costs. */
  into: number;
  next: number;
}

export function accountLevel(xp: number): AccountLevel {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (left >= levelCost(level)) {
    left -= levelCost(level);
    level++;
  }
  return { level, into: left, next: levelCost(level) };
}
