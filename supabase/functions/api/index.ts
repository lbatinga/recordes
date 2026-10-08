// Recordes de Corrida — backend.
// Strava OAuth (the client secret never leaves this function), token refresh,
// a read-only proxy to the athlete's own activities, and a small per-athlete
// document store. Sessions are random tokens; only their SHA-256 is stored.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CLIENT_ID = '285788';
const CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';
const APP_ORIGIN = 'https://recordes-pi.vercel.app';
const OTHER_ORIGINS = ['https://lbatinga.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];
const STRAVA = 'https://www.strava.com/api/v3';
const COLS = ['efforts', 'config'];

function serviceKey(): string {
  try {
    const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (k && k.default) return k.default;
  } catch (_) { /* fall back */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}
const sb = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

class HttpError extends Error {
  constructor(public status: number, public code: string, message = '', public extra: Record<string, unknown> = {}) {
    super(message || code);
  }
}

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  const allow = o === APP_ORIGIN || OTHER_ORIGINS.includes(o) ? o : APP_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'content-type, x-session, apikey, authorization, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function athleteFromSession(req: Request): Promise<number> {
  const tok = req.headers.get('x-session') ?? '';
  if (tok.length < 20) throw new HttpError(401, 'no_session');
  const h = await sha256(tok);
  const { data, error } = await sb.from('sessions').select('athlete_id, last_seen').eq('token_hash', h).maybeSingle();
  if (error) throw new HttpError(500, 'db_error', error.message);
  if (!data) throw new HttpError(401, 'no_session');
  if (Date.now() - new Date(data.last_seen).getTime() > 6 * 3600 * 1000) {
    await sb.from('sessions').update({ last_seen: new Date().toISOString() }).eq('token_hash', h);
  }
  return Number(data.athlete_id);
}

async function stravaOAuth(body: Record<string, string>) {
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
  });
  const t = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, t };
}

async function accessToken(aid: number): Promise<string> {
  const { data: a, error } = await sb.from('athletes').select('access_token, refresh_token, expires_at').eq('athlete_id', aid).maybeSingle();
  if (error) throw new HttpError(500, 'db_error', error.message);
  if (!a) throw new HttpError(401, 'needs_reauth');
  if (Number(a.expires_at) > Math.floor(Date.now() / 1000) + 300) return a.access_token;
  const { ok, status, t } = await stravaOAuth({ grant_type: 'refresh_token', refresh_token: a.refresh_token });
  if (!ok || !t.access_token) {
    if (status >= 500) throw new HttpError(502, 'upstream_error');
    throw new HttpError(401, 'needs_reauth');
  }
  await sb.from('athletes').update({
    access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, updated_at: new Date().toISOString(),
  }).eq('athlete_id', aid);
  return t.access_token;
}

async function stravaGet(aid: number, path: string): Promise<unknown> {
  const tok = await accessToken(aid);
  const r = await fetch(STRAVA + path, { headers: { Authorization: 'Bearer ' + tok } });
  if (r.status === 401) throw new HttpError(401, 'needs_reauth');
  if (r.status === 404) throw new HttpError(404, 'not_found');
  if (r.status === 429) {
    const now = new Date();
    const wait = (15 - (now.getUTCMinutes() % 15)) * 60 - now.getUTCSeconds();
    throw new HttpError(429, 'rate_limited', '', { retryAfterMs: Math.max(30, wait) * 1000 });
  }
  if (!r.ok) throw new HttpError(502, 'upstream_error', 'Strava ' + r.status);
  return await r.json();
}

// Same shape the page already understood (id, sport_type, start_local, summary…).
// deno-lint-ignore no-explicit-any
function mapActivity(a: any) {
  const tags: string[] = [];
  const w = a.workout_type;
  if (w === 1 || w === 11) tags.push('Race');
  if (w === 2) tags.push('LongRun');
  if (w === 3 || w === 12) tags.push('Workout');
  return {
    id: String(a.id),
    name: a.name ?? '',
    sport_type: a.sport_type || a.type,
    start_local: String(a.start_date_local ?? '').replace(/Z$/, ''),
    is_trainer: a.trainer === true,
    activity_tags: tags,
    location_summary: '',
    summary: {
      distance: a.distance ?? 0,
      moving_time: a.moving_time ?? 0,
      elapsed_time: a.elapsed_time ?? 0,
      relative_effort: typeof a.suffer_score === 'number' ? Math.round(a.suffer_score) : null,
      avg_cadence: typeof a.average_cadence === 'number' ? a.average_cadence : null,
    },
  };
}

async function listActivities(aid: number, after: number | null) {
  const out: unknown[] = [];
  let partial = false;
  for (let page = 1; page <= 15; page++) {
    const q = '/athlete/activities?per_page=200&page=' + page + (after ? '&after=' + after : '');
    let batch: unknown;
    try {
      batch = await stravaGet(aid, q);
    } catch (e) {
      if (page > 1 && e instanceof HttpError && e.code === 'rate_limited') { partial = true; break; }
      throw e;
    }
    if (!Array.isArray(batch)) throw new HttpError(502, 'shape');
    batch.forEach((a) => out.push(mapActivity(a)));
    if (batch.length < 200) break;
  }
  return { activities: out, has_next_page: false, partial };
}

async function handle(req: Request, path: string, url: URL): Promise<Response> {
  if (path === '/auth' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const code = String(b.code ?? '');
    const scope = String(b.scope ?? '');
    if (!code) throw new HttpError(400, 'bad_request');
    if (!scope.includes('activity:read')) throw new HttpError(400, 'scope');
    if (!CLIENT_SECRET) throw new HttpError(500, 'not_configured');
    const { ok, t } = await stravaOAuth({ grant_type: 'authorization_code', code });
    if (!ok || !t.access_token || !t.athlete) throw new HttpError(400, 'auth_failed');
    const ath = t.athlete;
    const { error } = await sb.from('athletes').upsert({
      athlete_id: ath.id, firstname: ath.firstname ?? null, lastname: ath.lastname ?? null,
      profile: ath.profile_medium ?? ath.profile ?? null,
      access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
      scope, updated_at: new Date().toISOString(),
    });
    if (error) throw new HttpError(500, 'db_error', error.message);
    const session = newToken();
    const ins = await sb.from('sessions').insert({ token_hash: await sha256(session), athlete_id: ath.id });
    if (ins.error) throw new HttpError(500, 'db_error', ins.error.message);
    return json(req, { session, athlete: { id: ath.id, firstname: ath.firstname, lastname: ath.lastname, profile: ath.profile_medium ?? null } });
  }

  const aid = await athleteFromSession(req);

  if (path === '/me' && req.method === 'GET') {
    const { data } = await sb.from('athletes').select('athlete_id, firstname, lastname, profile').eq('athlete_id', aid).maybeSingle();
    if (!data) throw new HttpError(401, 'needs_reauth');
    return json(req, { athlete: { id: data.athlete_id, firstname: data.firstname, lastname: data.lastname, profile: data.profile } });
  }
  if (path === '/activities' && req.method === 'GET') {
    const after = Number(url.searchParams.get('after')) || null;
    return json(req, await listActivities(aid, after));
  }
  if (path === '/streams' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    if (!/^\d{1,20}$/.test(id)) throw new HttpError(400, 'bad_request');
    return json(req, await stravaGet(aid, '/activities/' + id + '/streams?keys=time,distance&key_by_type=true'));
  }
  if (path === '/docs' && req.method === 'GET') {
    const { data, error } = await sb.from('docs').select('col, id, data').eq('athlete_id', aid);
    if (error) throw new HttpError(500, 'db_error', error.message);
    return json(req, { docs: data ?? [] });
  }
  if (path === '/docs' && req.method === 'PUT') {
    const b = await req.json().catch(() => null);
    const items = b && Array.isArray(b.items) ? b.items : b ? [b] : [];
    if (!items.length || items.length > 100) throw new HttpError(400, 'bad_request');
    const rows = items.map((it: { col?: string; id?: string; data?: unknown }) => {
      if (!COLS.includes(String(it.col)) || !/^[A-Za-z0-9_-]{1,40}$/.test(String(it.id)) || !it.data || typeof it.data !== 'object') {
        throw new HttpError(400, 'bad_request');
      }
      if (JSON.stringify(it.data).length > 60000) throw new HttpError(413, 'too_large');
      return { athlete_id: aid, col: it.col, id: it.id, data: it.data, updated_at: new Date().toISOString() };
    });
    const { error } = await sb.from('docs').upsert(rows);
    if (error) throw new HttpError(500, 'db_error', error.message);
    return json(req, { ok: true });
  }
  if (path === '/logout' && req.method === 'POST') {
    const tok = req.headers.get('x-session') ?? '';
    await sb.from('sessions').delete().eq('token_hash', await sha256(tok));
    return json(req, { ok: true });
  }
  throw new HttpError(404, 'no_route');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';
  try {
    return await handle(req, path, url);
  } catch (e) {
    if (e instanceof HttpError) {
      return json(req, { error: { code: e.code, message: e.message === e.code ? '' : e.message, retryable: e.status === 429 || e.status >= 500, ...e.extra } }, e.status);
    }
    console.error(e);
    return json(req, { error: { code: 'server_error', message: String((e as Error)?.message ?? e), retryable: true } }, 500);
  }
});
