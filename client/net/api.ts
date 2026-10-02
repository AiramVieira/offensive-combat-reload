// The account API (same origin: Vite proxies /api in dev, the game server or nginx in production). The
// session lives in an HttpOnly cookie the page never sees; nothing about it is stored in localStorage.
import type { ApiErrorCode, MeResponse, ProfileResponse } from '@shared/account';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'offline',
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function api<T = void>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON: the game server isn't behind this address (e.g. `bun run dev` without the server).
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new ApiError(res.status, 'offline');
  }
  if (!res.ok) {
    const { erro, ...extra } = data;
    // Vite answers 5xx when its proxy can't reach the game server.
    throw new ApiError(res.status, (erro as ApiErrorCode) ?? (res.status >= 500 ? 'offline' : 'erro_interno'), extra);
  }
  return data as T;
}

/** The signed-in account, or null (not signed in, or the server is down: `offline` tells which). */
export async function fetchMe(): Promise<{ me: MeResponse | null; offline: boolean }> {
  try {
    return { me: await api<MeResponse>('GET', '/api/me'), offline: false };
  } catch (err) {
    return { me: null, offline: err instanceof ApiError && err.code === 'offline' };
  }
}

export const fetchProfile = () => api<ProfileResponse>('GET', '/api/perfil');
