// Account API shapes and rules shared by the client (forms) and the server (validation).
import type { ProgWeapon } from './progression';
import type { Sex } from './protocol';

export const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,14}[\p{L}\p{N}]$/u;
export const NAME_MIN = 3;
export const NAME_MAX = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const EMAIL_MAX = 254;
/** Days between name changes (the first change after sign-up is free). */
export const NAME_COOLDOWN_DAYS = 7;
/** Days an account waits in pending deletion before it is anonymized. */
export const DELETION_GRACE_DAYS = 30;

export const cleanName = (raw: unknown) => String(raw ?? '').replace(/\s+/g, ' ').trim();
export const validName = (name: string) => NAME_RULE.test(name);
export const validEmail = (email: string) => email.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validPassword = (p: string) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
export const formatTag = (name: string, discriminator: number) => `${name}#${String(discriminator).padStart(4, '0')}`;

/** GET /api/me */
export interface MeResponse {
  tag: string;
  nivel: number;
  sexo: Sex;
  provedores: ('senha' | 'discord')[];
  /** Set while the account waits for deletion: when it will be anonymized (ISO date). */
  exclusaoEm: string | null;
}

export interface WeaponProgress {
  xp: number;
  nivel: number;
  equipado: number;
}

export interface Participation {
  sessao: string;
  entrada: string;
  saida: string | null;
  abates: number;
  mortes: number;
  pontos: number;
  humilhacoes: number;
  xp: number;
}

export interface Totals {
  abates: number;
  mortes: number;
  cabeca: number;
  passaro: number;
  facadas: number;
  pelasCostas: number;
  granadas: number;
  humilhacoes: number;
  segundosJogados: number;
  participacoes: number;
}

/** GET /api/perfil */
export interface ProfileResponse {
  tag: string;
  nome: string;
  sexo: Sex;
  nivel: number;
  xp: number;
  /** XP inside the current level and the cost of the next one. */
  xpNoNivel: number;
  xpProximo: number;
  armas: Record<ProgWeapon, WeaponProgress>;
  totais: Totals;
  participacoes: Participation[];
  /** When the name can be changed again (ISO date), null = now. */
  nomeLiberaEm: string | null;
  provedores: ('senha' | 'discord')[];
  exclusaoEm: string | null;
}

/** Error codes returned by the API ({ erro }). */
export type ApiErrorCode =
  | 'nao_autorizado'
  | 'credenciais_invalidas'
  | 'muitas_tentativas'
  | 'conta_suspensa'
  | 'conta_em_exclusao'
  | 'email_em_uso'
  | 'email_invalido'
  | 'senha_invalida'
  | 'nome_invalido'
  | 'nome_esgotado'
  | 'cooldown_nome'
  | 'token_invalido'
  | 'unica_forma_de_entrar'
  | 'discord_indisponivel'
  | 'discord_ja_vinculado'
  | 'nivel_bloqueado'
  | 'origem_invalida'
  | 'nao_encontrado'
  | 'json_invalido'
  | 'corpo_grande_demais'
  | 'erro_interno';
