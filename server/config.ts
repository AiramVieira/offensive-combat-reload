// Server settings from the environment. Defaults match `docker compose up -d banco redis` on this machine,
// so `bun run dev:online` works with no .env file.
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

export const CONFIG = {
  production: process.env.NODE_ENV === 'production',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://oc:oc@localhost:5442/oc',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6392',
  /**
   * Extra origins allowed to call the API and open the WebSocket. Same-origin requests (the page served
   * by this server, by nginx or through Vite's proxy) are always allowed.
   */
  origins: list(process.env.ORIGENS_PERMITIDAS),
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
    /** Full return URLs registered in the Discord app, one per address the game is played from. */
    returns: list(process.env.DISCORD_RETORNOS),
  },
  smtp: {
    user: process.env.SMTP_USUARIO ?? '',
    appPassword: process.env.SMTP_SENHA_APP ?? '',
    from: process.env.SMTP_REMETENTE ?? process.env.SMTP_USUARIO ?? '',
  },
};
