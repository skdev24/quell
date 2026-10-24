import type { Ban, CorrectionInput, EvalRun, LiveState, Rule, SwarmState } from '@quell/shared';

/** The API runs beside the web app; on a phone this resolves to the laptop's LAN address. */
export function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  return `${window.location.protocol}//${window.location.hostname}:4000/api`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    // Only bodies need a content type; leaving it off GETs avoids a CORS preflight.
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  state: () => call<LiveState>('/state'),
  correct: (id: string, input: CorrectionInput) =>
    call<{ rule: Rule; replaying: number }>(`/messages/${id}/correct`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeRule: (id: string) => call<{ ok: true }>(`/rules/${id}`, { method: 'DELETE' }),
  swarm: (patch: Partial<Pick<SwarmState, 'running' | 'rate' | 'scamWave'>>) =>
    call<SwarmState>('/swarm', { method: 'POST', body: JSON.stringify(patch) }),
  evaluate: () => call<EvalRun>('/eval', { method: 'POST' }),
  demo: (stage: 'teach' | 'again' | 'reset') => call<{ posted?: number }>(`/demo/${stage}`, { method: 'POST' }),
  info: () => call<{ lan: string[] }>('/info'),
  raid: (count = 150) => call<{ posted: number }>('/swarm/raid', { method: 'POST', body: JSON.stringify({ count }) }),
  ingest: (author: string, text: string, device?: string) =>
    call<{ id: string }>('/ingest', { method: 'POST', body: JSON.stringify({ author, text, device }) }),
  /** The moderator speaking in chat: badged, and not sent to the model. */
  say: (text: string) => call<{ id: string }>('/mod/say', { method: 'POST', body: JSON.stringify({ text }) }),
  /** Minutes for a timeout; null bans until a moderator lifts it. */
  ban: (messageId: string, minutes: number | null) =>
    call<Ban>(`/messages/${messageId}/ban`, { method: 'POST', body: JSON.stringify({ minutes }) }),
  unban: (id: string) => call<{ ok: true }>(`/bans/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
