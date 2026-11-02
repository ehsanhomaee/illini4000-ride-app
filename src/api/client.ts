import { prefs } from '../lib/db';
import { demoCall } from './demo';

// public/config.json is the one file a leader edits after deploying the
// Google Apps Script backend. With no apiUrl the app runs in demo mode.
export interface AppConfig { apiUrl: string; teamName: string }

let appConfig: AppConfig = { apiUrl: '', teamName: 'Illini 4000' };

export async function loadAppConfig(): Promise<AppConfig> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch('./config.json', { cache: 'no-cache', signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) appConfig = { ...appConfig, ...(await res.json()) };
    else throw new Error('config');
  } catch {
    const cached = prefs.get<AppConfig | null>('appConfig', null);
    if (cached) appConfig = cached;
  }
  prefs.set('appConfig', appConfig);
  return appConfig;
}

export async function applySavedConfig(saved: Partial<AppConfig>) {
  appConfig = { ...appConfig, ...saved };
}

export function apiUrl(): string {
  return (prefs.get<string>('apiUrlOverride', '') || appConfig.apiUrl || '').trim();
}
export function isDemo(): boolean {
  return !apiUrl();
}
export function teamName(): string {
  return appConfig.teamName || 'Illini 4000';
}

/** The server said no (wrong PIN, not allowed, missing row…). Retrying will not help. */
export class ApiError extends Error {
  auth: boolean;
  /** Google was busy (lock wait, quota, timeout): fine to try again later. */
  retryable: boolean;
  constructor(message: string) {
    const auth = message.startsWith('AUTH:');
    super(auth ? message.slice(5).trim() : message);
    this.auth = auth;
    this.retryable = !auth && /lock|timed out|timeout|too many|simultaneous|try again|will retry|service unavailable|internal error|exceeded maximum|rate limit|backend error/i.test(message);
  }
}
/** Could not reach the server (no signal, timeout). Safe to retry later. */
export class NetworkError extends Error {}

let token = prefs.get<string>('token', '');
export function setToken(t: string) { token = t; if (t) prefs.set('token', t); else prefs.del('token'); }
export function getToken() { return token; }

export async function call<T = unknown>(action: string, params: Record<string, unknown> = {}, timeoutMs = 60000): Promise<T> {
  const body = { action, token, ...params };
  if (isDemo()) return demoCall(action, body) as Promise<T>;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError('You are offline.');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    // text/plain keeps this a "simple" request, which Apps Script accepts from any site.
    res = await fetch(apiUrl(), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: ctl.signal,
    });
  } catch (e) {
    throw new NetworkError((e as Error).name === 'AbortError' ? 'The server took too long to answer.' : 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new NetworkError(`The server answered ${res.status}.`);
  const text = await res.text();
  let j: { ok: boolean; data?: T; error?: string };
  try {
    j = JSON.parse(text);
  } catch {
    if (/accounts\.google\.com|ServiceLogin|<title>Sign in/i.test(text)) {
      throw new ApiError('The backend asked for a Google sign-in. Redeploy the Apps Script web app with "Who has access" set to "Anyone".');
    }
    throw new NetworkError('Google returned an error page. Trying again shortly.'); // usually a passing hiccup
  }
  if (!j.ok) throw new ApiError(j.error || 'Something went wrong on the server.');
  return j.data as T;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
