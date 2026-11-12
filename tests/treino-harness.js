// Carrega o código REAL do Treino do dia (treino.html) numa caixa de areia: sem tela, sem rede, sem banco.
//   const t = loadTreino('2026-11-10T08:00:00', { races, rests, keep, cfg, logs });
//   t.plan('2026-11-28')   // agenda dia a dia;   t.ev('expressão')   // qualquer coisa de dentro da página
'use strict';
process.env.TZ = 'America/Maceio';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function anything() {
  const f = function () { return p; };
  const p = new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      if (k === 'length' || k === 'childElementCount') return 0;
      if (k === 'hidden' || k === 'disabled' || k === 'checked' || k === 'open') return false;
      if (k === 'value' || k === 'textContent' || k === 'innerHTML') return '';
      if (k === 'forEach' || k === 'map' || k === 'filter') return () => [];
      return p;
    },
    set() { return true; },
    apply() { return p; },
  });
  return p;
}
const SANTANDER = [{ d: '2026-11-21', name: 'Santander Night Run', km: 5, time: '20:00' }];

function loadTreino(nowIso, o) {
  o = o || {};
  const html = fs.readFileSync(path.join(__dirname, '..', 'treino.html'), 'utf8');
  const start = html.indexOf('<script>\n(function(){\n  var NAMES');
  if (start < 0) throw new Error('não achei o script do treino.html');
  let src = html.slice(start + '<script>'.length, html.indexOf('</script>', start));
  const tail = /\}\)\(\);\s*$/;
  if (!tail.test(src)) throw new Error('fim do script mudou: ajuste o harness');
  src = src.replace(tail, '  globalThis.__ev = function(c){ return eval(c); };\n})();\n');
  const store = {
    'tdd-races': JSON.stringify(o.races || SANTANDER), 'tdd-rests': JSON.stringify(o.rests || {}), 'tdd-keep': JSON.stringify(o.keep || {}),
    'tdd-cfg': JSON.stringify(o.cfg || {}), 'tdd-log': JSON.stringify(o.logs || {}),
  };
  Object.assign(store, o.extra || {});
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, JSON, Math, Promise,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    getComputedStyle: () => anything(), location: { hash: '' }, history: { replaceState() {} }, navigator: {}, document: anything(),
    addEventListener: () => {}, removeEventListener: () => {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(`var __FIX = ${new Date(nowIso).getTime()}; (function(){ var R = Date; function D(a){ var x = arguments.length ? new R(a) : new R(__FIX); Object.setPrototypeOf(x, D.prototype); return x; }
    D.prototype = Object.create(R.prototype); D.prototype.constructor = D; D.now = function(){ return __FIX; }; Date = D; })()`, ctx);
  vm.runInContext(src, ctx, { filename: 'treino.html(script)' });
  const ev = (c) => ctx.__ev(c);
  const json = (c) => JSON.parse(ev('JSON.stringify(' + c + ')'));
  return {
    ev, json,
    // avança o relógio em segundos (pro modo treino)
    passa(seg) { vm.runInContext('__FIX += ' + (seg * 1000), ctx); },
    plan: (ate) => json('buildPlan(rests, ' + JSON.stringify(ate) + ')'),
    // Treinos feitos: stats = { id: {date, type, km, hr, v} } (o que vem do Strava) e logs = { dia: {A:{0:{hr,dur}}, L:{0:{hr,dur}}} } (o que a pessoa anota).
    feitos(logs, stats) { ctx.__l = JSON.stringify(logs || {}); ctx.__s = JSON.stringify(stats || {}); ev('window.__tdd.inject(JSON.parse(__l), JSON.parse(__s))'); },
    degraus: (dia) => json('replay(' + JSON.stringify(dia) + ')'),
  };
}
module.exports = { loadTreino, SANTANDER };
