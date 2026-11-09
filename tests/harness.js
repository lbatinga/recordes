// Carrega o código REAL do app (index.html) e do backend (supabase/functions/api/index.ts)
// dentro de uma caixa de areia, sem rede, sem banco e sem tela. Nada aqui publica ou altera dados.
//
//   const { loadApp, loadServer } = require('./harness');
//   const app = loadApp('2026-11-09T17:00:00');   // "agora" fixo, horário de Maceió
//   app.ev('streakInfo(state.sessions)')           // roda qualquer expressão dentro do app
'use strict';
process.env.TZ = 'America/Maceio';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// Objeto que aceita qualquer chamada: faz o papel do DOM, que os testes não usam.
function anything() {
  const f = function () { return p; };
  const p = new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined; // não é uma Promise
      if (k === 'length') return 0;
      if (k === 'hidden' || k === 'disabled' || k === 'checked') return false;
      if (k === 'value' || k === 'textContent' || k === 'innerHTML') return '';
      if (k === 'forEach' || k === 'map' || k === 'filter') return () => [];
      return p;
    },
    set() { return true; },
    apply() { return p; },
  });
  return p;
}

function fakeDateSource(nowIso) {
  return `(function(){
    var R = Date, FIX = new R(${JSON.stringify(nowIso)}).getTime();
    function D(a, b, c, d, e, f, g){
      if (!(this instanceof D)) return new R(FIX).toString();
      var n = arguments.length, x;
      if (n === 0) x = new R(FIX);
      else if (n === 1) x = new R(a);
      else x = new R(a, b, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0);
      Object.setPrototypeOf(x, D.prototype);
      return x;
    }
    D.prototype = Object.create(R.prototype); D.prototype.constructor = D;
    D.now = function(){ return FIX; }; D.UTC = R.UTC; D.parse = R.parse;
    D.__set = function(iso){ FIX = new R(iso).getTime(); };
    return D;
  })()`;
}

function loadApp(nowIso) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf("<script>\n(function(){\n  'use strict';");
  if (start < 0) throw new Error('não achei o script principal do index.html');
  const end = html.indexOf('</script>', start);
  let src = html.slice(start + '<script>'.length, end);
  // Em vez de iniciar o app (login, rede), deixa uma porta para os testes rodarem código lá dentro.
  const tail = /\n\s*start\(\);\s*\n\}\)\(\);\s*$/;
  if (!tail.test(src)) throw new Error('fim do script mudou: ajuste o harness');
  src = src.replace(tail, '\n  globalThis.__ev = function(c){ return eval(c); };\n})();\n');

  const store = {};
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, JSON, Math, Promise,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    location: { origin: 'https://teste.local', pathname: '/', search: '', protocol: 'http:', href: 'https://teste.local/' },
    navigator: { userAgent: 'node', onLine: true },
    document: anything(),
    fetch: () => Promise.reject(new Error('sem rede nos testes')),
    addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    confirm: () => true, scrollTo: () => {}, requestAnimationFrame: () => 0, innerWidth: 400, innerHeight: 800, scrollY: 0,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext('Date = ' + fakeDateSource(nowIso || '2026-11-09T17:00:00'), ctx);
  vm.runInContext(src, ctx, { filename: 'index.html(script)' });
  const ev = (code) => ctx.__ev(code);

  const app = {
    ev,
    setNow(iso) { vm.runInContext('Date.__set(' + JSON.stringify(iso) + ')', ctx); ev('bumpData()'); },
    // Coloca atividades (formato que o backend entrega em /activities) e prepara o estado como o onData faz.
    setActivities(acts, opts) {
      ctx.__acts = JSON.parse(JSON.stringify(acts));
      ctx.__opts = JSON.parse(JSON.stringify(opts || {}));
      ev(`(function(){
        var o = globalThis.__opts;
        effortDocs = o.efforts || {};
        PAUSES = o.pauses || {}; PAINEL = o.painel || {}; ENV_OVERRIDE = o.env || {}; KM_OVERRIDE = o.km || {};
        VERIFIED = o.verified || {}; DESCS = o.descs || {}; EXTRA_ACTS = o.add || [];
        RANGE_START = o.range_start || ''; WALK_UNTIL = o.walk_until || ''; SEX = o.sex || 'M'; BIRTH = o.birth || '1994-05-10';
        setRaces(o.races || []);
        GOALS = {}; GOAL = getGoal(goalK);
        me = o.me || { id: 1, firstname: 'Lucas' };
        group = o.group || []; partner = group[0] || null; partnerLoaded = true;
        var acts = globalThis.__acts.slice();
        EXTRA_ACTS.forEach(function(a){ acts.push(a); });
        lastActs = acts;
        state.sessions = buildSessions(acts);
        state.activeDays = {};
        acts.forEach(function(a){
          var mt = Number((a.summary || {}).moving_time) || 0, day = (a.start_local || '').slice(0, 10);
          if (RANGE_START && day < RANGE_START.slice(0, 10)) return;
          if (day && mt >= 600) state.activeDays[day] = true;
        });
        state.sessions.forEach(function(s){ if (s.d) state.activeDays[isoOf(s.d)] = true; });
        // sessões sem esforços calculados ganham um doc vazio, para "allAnalyzed" valer
        state.sessions.forEach(function(s){ if (!effortDocs[s.id]) effortDocs[s.id] = { v: ALGO, efforts: {}, noStreams: true }; });
        db = null; dbLoaded = true; goalLoaded = true; processing = false; state.status = 'ready';
        bumpData();
      })()`);
    },
    json(code) { return JSON.parse(ev('JSON.stringify(' + code + ')')); },
  };
  return app;
}

// ---------- fábrica de atividades (o formato de mapActivity no backend) ----------
let seq = 1000;
function act(o) {
  const id = String(o.id || ++seq);
  const km = o.km != null ? o.km : 5;
  const time = o.time != null ? o.time : Math.round(km * 480);
  const tags = o.race ? ['Race'] : [];
  return {
    id, name: o.name || 'Corrida', sport_type: o.type || 'Run',
    start_local: o.start.length === 10 ? o.start + 'T06:00:00' : o.start,
    is_trainer: !!o.trainer, activity_tags: tags, location_summary: '',
    latlng: o.latlng === undefined ? [-9.66, -35.71] : o.latlng,
    description: o.desc,
    summary: { distance: Math.round(km * 1000), moving_time: time, elapsed_time: o.elapsed != null ? o.elapsed : time,
      relative_effort: null, avg_cadence: null, avg_hr: null },
  };
}
// Esforços por distância já calculados (o que fica em efforts/<id>): { '5000': 2400, ... }
function eff(efforts, trot) { return { v: 4, efforts: efforts || {}, trot: trot || { t: 0, m: 0 }, tn: 1 }; }

// ---------- backend ----------
// Tira os tipos do TypeScript e roda o arquivo com Supabase, Strava e web-push de mentira.
function loadServer(nowIso, world) {
  const { stripTypeScriptTypes } = require('module');
  let ts = fs.readFileSync(path.join(ROOT, 'supabase/functions/api/index.ts'), 'utf8');
  ts = ts.replace(/^import .*$/gm, '');
  ts = ts.replace(/constructor\(public status: number, public code: string, message = '', public extra: Record<string, unknown> = \{\}\) \{\s*super\(message \|\| code\);\s*\}/,
    "status: number; code: string; extra: Record<string, unknown>;\n  constructor(status: number, code: string, message = '', extra: Record<string, unknown> = {}) { super(message || code); this.status = status; this.code = code; this.extra = extra; }");
  let js = stripTypeScriptTypes(ts, { mode: 'strip' });
  js += '\nglobalThis.__srv = function(c){ return eval(c); };\n';

  world = world || {};
  world.docs = world.docs || {};         // chave "aid|col|id" -> data
  world.strava = world.strava || {};     // aid -> lista de atividades (formato da API do Strava)
  world.pushes = [];
  const docKey = (f) => [f.athlete_id, f.col, f.id].join('|');
  function query(table) {
    const f = {}; let op = 'select', payload = null;
    const q = {
      select() { return q; }, eq(k, v) { f[k] = v; return q; }, in(k, v) { f[k + '__in'] = v; return q; }, like() { return q; }, lt() { return q; },
      delete() { op = 'delete'; return q; }, update(p) { op = 'update'; payload = p; return q; },
      upsert(row) { (Array.isArray(row) ? row : [row]).forEach((r) => { if (table === 'docs') world.docs[docKey(r)] = JSON.parse(JSON.stringify(r.data)); }); return Promise.resolve({ error: null }); },
      insert() { return Promise.resolve({ error: null }); },
      maybeSingle() {
        if (table === 'docs') { const d = world.docs[docKey(f)]; return Promise.resolve({ data: d ? { data: d, updated_at: world.updated_at || null } : null, error: null }); }
        if (table === 'athletes') return Promise.resolve({ data: { athlete_id: f.athlete_id, access_token: 't', refresh_token: 'r', expires_at: 9e12, scope: 'activity:read_all' }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
    };
    return q;
  }
  const sandbox = {
    console, URL, URLSearchParams, TextEncoder, crypto: require('crypto').webcrypto, btoa, Response: class { constructor(b, i) { this.body = b; this.init = i; } },
    Deno: { env: { get: (k) => (k === 'SUPABASE_URL' ? 'http://x' : 'k') }, serve() {} },
    createClient: () => ({ from: query }),
    webpush: { generateVAPIDKeys: () => ({ publicKey: 'p', privateKey: 'k' }), generateRequestDetails: () => ({}) },
    fetch: (url) => {
      const m = /athlete\/activities\?[^]*?after=(\d+)/.exec(String(url));
      const aid = world.currentAid;
      const after = m ? Number(m[1]) : 0;
      const list = (world.strava[aid] || []).filter((a) => Date.parse(a.start_date) / 1000 >= after);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(list) });
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext('Date = ' + fakeDateSource(nowIso || '2026-11-09T17:00:00-03:00'), ctx);
  vm.runInContext(js, ctx, { filename: 'api/index.ts' });
  return {
    world,
    ev: (c) => ctx.__srv(c),
    setNow(iso) { vm.runInContext('Date.__set(' + JSON.stringify(iso) + ')', ctx); },
    async refreshLive(aid) { world.currentAid = aid; return JSON.parse(JSON.stringify(await ctx.__srv('refreshLive(' + aid + ')'))); },
    async weekStatus(aid) { world.currentAid = aid; return JSON.parse(JSON.stringify(await ctx.__srv('weekStatus(' + aid + ')'))); },
  };
}
// Atividade no formato cru do Strava (o que o servidor lê).
function stravaAct(o) {
  const local = o.start.length === 10 ? o.start + 'T06:00:00' : o.start;
  return {
    id: o.id || ++seq, name: o.name || 'Corrida', sport_type: o.type || 'Run', trainer: !!o.trainer,
    start_date_local: local + 'Z', start_date: new Date(local + '-03:00').toISOString(),
    start_latlng: o.latlng === undefined ? [-9.6612, -35.7105] : (o.latlng || []),
    distance: Math.round((o.km != null ? o.km : 5) * 1000), moving_time: o.time != null ? o.time : 2400, elapsed_time: o.time != null ? o.time : 2400,
  };
}

module.exports = { loadApp, loadServer, act, eff, stravaAct };
