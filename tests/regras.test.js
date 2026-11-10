// Testes das regras do Recordes, rodando o código real do index.html.
//   node --test tests/*.test.js     (Node 22 ou mais novo)
// Cada teste afirma o que o TEXTO DE AJUDA do app promete (ou o que a regra diz no código).
// [E..] no nome liga o teste a um erro do relatório "Recordes: revisão das regras (09/11/2026)".
// Depois das correções do ramo correcoes-revisao todos passam; os marcados "todo" ficaram pra depois.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, act, eff } = require('./harness');

const HOJE = '2026-11-09T17:00:00'; // segunda-feira
const tick = () => new Promise((r) => setImmediate(r));
const ajuda = (app) => app.ev('JSON.stringify(helpTopics())');
const tabela = (app, env, k) => app.json(`(analyze(state.sessions,"${env}").tables["${k}"]||[]).map(function(e){return {id:e.s.id,t:e.t,official:e.official}})`);

// ───────────────────────── Esteira, rua e prova ─────────────────────────
test('esteira lançada à mão, sem GPS: vira esteira, conta na semana, nos km e nos dias ativos', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-03', km: 3, time: 1500, latlng: null, name: 'Corrida da tarde' })]);
  const s = app.json('state.sessions[0]');
  assert.equal(s.env, 'esteira');
  assert.equal(app.json('streakInfo(state.sessions).weeks.slice(-2)[0].n'), 1);
  assert.equal(app.json('monthStats().km["2026-11"]'), 3);
  assert.equal(app.json('monthStats().days["2026-11"]'), 1);
});

test('esteira lançada à mão: entra no recorde de pace da faixa dela (3 a 5 km)', () => {
  const app = loadApp(HOJE);
  app.setActivities([
    act({ id: '1', start: '2026-10-20', km: 3, time: 1500, latlng: null }),
    act({ id: '2', start: '2026-11-03', km: 3, time: 1440, latlng: null }),
  ]);
  assert.equal(app.json('analyze(state.sessions,"esteira").best.pace3.id'), '2');
});

test('[E12] esteira lançada à mão, sem gravação e com distância redonda: o tempo total vale na distância (5,00 km em 42min29s)', () => {
  const app = loadApp(HOJE);
  app.setActivities([
    act({ id: '1', start: '2026-11-03', km: 5, time: 2549, latlng: null }),
    act({ id: '2', start: '2026-11-04', km: 5.05, time: 2600, latlng: null }), // 1% acima: vale
    act({ id: '3', start: '2026-11-05', km: 5.2, time: 2500, latlng: null }),  // 4% acima: não é 5 km redondo
    act({ id: 'manual-x', start: '2026-11-06', km: 3, time: 1500, latlng: null }), // lançada pelo dono (overrides.add)
  ]);
  assert.deepEqual(tabela(app, 'esteira', '5000').map((x) => [x.id, x.t]), [['1', 2549], ['2', 2600]]);
  assert.deepEqual(tabela(app, 'esteira', '3000').map((x) => x.id), ['manual-x']);
  assert.deepEqual(tabela(app, 'rua', '5000'), [], 'esteira não entra na rua nem na meta');
});

test('[E12] esteira COM gravação continua usando os trechos do relógio, não o tempo total', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-03', km: 5.02, time: 2549, latlng: null })], { efforts: { 1: eff({ 5000: 2540 }) } });
  assert.equal(tabela(app, 'esteira', '5000')[0].t, 2540);
});

test('painel da esteira digitado substitui a distância do relógio', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-03', km: 2.8, time: 1500, latlng: null })], { painel: { 1: 3 } });
  assert.equal(app.json('state.sessions[0].km'), 3);
});

test('rua e esteira têm tabelas de tempo separadas', () => {
  const app = loadApp(HOJE);
  app.setActivities([
    act({ id: 'r', start: '2026-10-10', km: 5, time: 2500 }),
    act({ id: 'e', start: '2026-10-12', km: 5, time: 2400, latlng: null }),
  ], { efforts: { r: eff({ 5000: 2500 }), e: eff({ 5000: 2400 }) } });
  assert.deepEqual(tabela(app, 'rua', '5000').map((x) => x.id), ['r']);
  assert.deepEqual(tabela(app, 'esteira', '5000').map((x) => x.id), ['e']);
  assert.equal(app.json('currentBest("5000").t'), 2500, 'a meta usa só a rua');
});

test('[E5] prova sem GPS: sem tempo oficial conta como esteira; com tempo oficial conta como rua', () => {
  const app = loadApp(HOJE);
  const A = [act({ id: '1', start: '2026-10-31', km: 4.99, time: 1800, race: true, latlng: null })];
  app.setActivities(A, { races: [{ date: '2026-10-31', name: 'BB', km: 5 }] });
  assert.equal(app.json('state.sessions[0].env'), 'esteira');
  assert.deepEqual(tabela(app, 'rua', '5000'), [], 'tempo digitado à mão não entra em rua, metas nem nível');
  assert.equal(app.json('buildSummaryCore().ag'), null);
  app.setActivities(A, { races: [{ date: '2026-10-31', name: 'BB', km: 5, chip: 1795.4 }] });
  assert.equal(app.json('state.sessions[0].env'), 'rua');
  assert.deepEqual(tabela(app, 'rua', '5000'), [{ id: '1', t: 1795.4, official: true }]);
});

// ───────────────────────── Prova e tempo oficial ─────────────────────────
test('prova com tempo oficial: vale o oficial na distância da prova; os trechos menores seguem do relógio', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'bb', start: '2026-10-31T19:30:00', km: 5.08, time: 2830, elapsed: 2850, race: true })], {
    efforts: { bb: eff({ 1000: 520, 5000: 2800 }) },
    races: [{ date: '2026-10-31', name: 'BB', km: 5, chip: 2842.906 }],
  });
  assert.deepEqual(tabela(app, 'rua', '5000'), [{ id: 'bb', t: 2842.906, official: true }]);
  assert.equal(tabela(app, 'rua', '1000')[0].t, 520);
  const s = app.json('(function(){var s=state.sessions[0];return {km:s.km,time:s.time}})()');
  assert.deepEqual(s, { km: 5, time: 2842.906 });
  assert.equal(app.ev('fmtOff(2842.906)'), '47min22,9s', 'décimos cortados, nunca arredondados');
});

test('tempo oficial digitado depois: a base da meta que vinha dessa prova é recalculada', () => {
  const app = loadApp(HOJE);
  const A = [act({ id: 'bb', start: '2026-10-31T19:30:00', km: 5.08, time: 2830, elapsed: 2850, race: true })];
  app.setActivities(A, { efforts: { bb: eff({ 5000: 2800 }) }, races: [{ date: '2026-10-31', name: 'BB', km: 5 }] });
  app.ev('maybeUpdateGoal()');
  assert.equal(app.json('GOALS["5000"].baseT'), 2850, 'sem oficial, a base é o tempo total');
  app.ev('setRaces([{date:"2026-10-31",name:"BB",km:5,chip:2842.906}]); bumpData(); maybeUpdateGoal()');
  assert.equal(app.json('GOALS["5000"].baseT'), 2842.906);
  assert.equal(app.json('GOALS["5000"].hi'), Math.round(2842.906 * 0.95));
});

test('[E7] prova sem tempo oficial: vale o tempo total na tabela e na meta (ajuda: "do início ao fim, como no Strava")', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'p', start: '2026-10-31', km: 5.08, time: 2830, elapsed: 2842, race: true })], {
    efforts: { p: eff({ 1000: 520, 5000: 2800 }) }, races: [{ date: '2026-10-31', name: 'BB', km: 5 }],
  });
  assert.deepEqual(tabela(app, 'rua', '5000'), [{ id: 'p', t: 2842, official: true }]);
  assert.equal(tabela(app, 'rua', '1000')[0].t, 520, 'os trechos menores continuam vindo do relógio');
  app.ev('maybeUpdateGoal()');
  assert.equal(app.json('GOALS["5000"].baseT'), 2842);
});

test('prova com o relógio até 2% curto conta na distância oficial, com o tempo total', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'p', start: '2026-10-31', km: 4.93, time: 2800, elapsed: 2842, race: true })], {
    efforts: { p: eff({ 1000: 520 }) }, races: [{ date: '2026-10-31', name: 'BB', km: 5 }],
  });
  assert.deepEqual(tabela(app, 'rua', '5000'), [{ id: 'p', t: 2842, official: true }]);
});

test('[E6] a margem de 2% vale só pra distância oficial: prova de 5 km com 4,75 km no relógio não ganha tempo de "3 milhas"', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'p', start: '2026-10-31', km: 4.75, time: 1700, elapsed: 1750, race: true })], {
    efforts: { p: eff({ 1000: 330, 4000: 1420 }) }, races: [{ date: '2026-10-31', name: 'BB', km: 5 }],
  });
  assert.deepEqual(tabela(app, 'rua', '4828'), []);
  assert.deepEqual(tabela(app, 'rua', '5000'), [], '5% curto: fora da margem, também não vale como 5 km');
  assert.equal(tabela(app, 'rua', '4000')[0].t, 1420);
});

test('[E6] prova com exatamente 5,000 km no Strava e sem trecho calculado tem tempo nos 5 km (como a de 4,99 km)', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'p', start: '2026-10-31', km: 5, time: 1800, race: true })], { races: [{ date: '2026-10-31', name: 'BB', km: 5 }] });
  assert.equal(tabela(app, 'rua', '5000').length, 1);
});

// ───────────────────────── Recordes e "primeira vez" ─────────────────────────
test('primeira vez numa distância não conta em "Dias com recorde"; bater um tempo que já existia conta', () => {
  const app = loadApp(HOJE);
  const A = [
    act({ id: 'a', start: '2026-10-10', km: 3, time: 1500 }),
    act({ id: 'b', start: '2026-11-03', km: 5, time: 2500 }), // primeiro 5 km da vida, 3 km mais lento que o recorde
  ];
  const E = { a: eff({ 1000: 480, 3000: 1500 }), b: eff({ 1000: 490, 3000: 1510, 5000: 2500 }) };
  app.setActivities(A, { efforts: E });
  assert.equal(app.json('buildSummaryCore().recDaysE'), 0);
  A.push(act({ id: 'c', start: '2026-11-06', km: 5, time: 2450 })); E.c = eff({ 1000: 485, 3000: 1505, 5000: 2450 });
  app.setActivities(A, { efforts: E });
  assert.equal(app.json('buildSummaryCore().recDaysE'), 1);
});

test('dois recordes no mesmo dia contam como um dia', () => {
  const app = loadApp(HOJE);
  app.setActivities([
    act({ id: 'a', start: '2026-10-10', km: 5, time: 2500 }),
    act({ id: 'b', start: '2026-11-03T06:00:00', km: 5, time: 2450 }),
    act({ id: 'c', start: '2026-11-03T18:00:00', km: 5, time: 2400 }),
  ], { efforts: { a: eff({ 1000: 480, 5000: 2500 }), b: eff({ 1000: 470, 5000: 2450 }), c: eff({ 1000: 460, 5000: 2400 }) } });
  assert.equal(app.json('buildSummaryCore().recDaysE'), 1);
});

test('rua e esteira com recordes separados (regra de novembro/2026)', () => {
  const app = loadApp(HOJE);
  const A = [
    act({ id: 'r1', start: '2026-10-10', km: 5, time: 2500 }),
    act({ id: 'e1', start: '2026-11-02', km: 5, time: 2400, latlng: null }), // primeiro 5 km na esteira: mais rápido que a rua, mas é o primeiro da lista dele
  ];
  const E = { r1: eff({ 5000: 2500 }), e1: eff({ 5000: 2400 }) };
  app.setActivities(A, { efforts: E });
  let s = app.json('buildSummaryCore()');
  assert.equal(s.recDaysE, 0, 'esteira não bate recorde da rua');
  assert.equal(s.recDaysM, 1, 'pela regra antiga (rua e esteira juntas) contaria');
  // rua mais lenta que a esteira, mas melhor que a rua anterior: conta
  A.push(act({ id: 'r2', start: '2026-11-04', km: 5, time: 2450 })); E.r2 = eff({ 5000: 2450 });
  // esteira batendo a própria esteira: conta
  A.push(act({ id: 'e2', start: '2026-11-06', km: 5, time: 2390, latlng: null })); E.e2 = eff({ 5000: 2390 });
  app.setActivities(A, { efforts: E });
  s = app.json('buildSummaryCore()');
  assert.equal(s.recDaysE, 2);
});

test('o placar de novembro usa a linha nova de recordes; o de outubro, a antiga', () => {
  const app = loadApp(HOJE);
  const pega = (ref) => app.ev(`linesFor("${ref}").filter(function(L){return L.id==="recDays"})[0].get({month:"${ref}",recDaysE:5,recDaysM:3,recDays:9},"${ref}")`);
  assert.equal(pega('2026-11'), 5);
  assert.equal(pega('2026-10'), 3);
});

test('[E16] ajuda descreve o selo: a primeira vez numa distância ganha selo no treino e não pontua; o 1º treino não ganha', () => {
  const app = loadApp(HOJE);
  app.setActivities([
    act({ id: 'a', start: '2026-10-10', km: 3, time: 1500 }),
    act({ id: 'b', start: '2026-11-03', km: 5, time: 2500 }),
  ], { efforts: { a: eff({ 3000: 1500 }), b: eff({ 3000: 1510, 5000: 2500 }) } });
  assert.deepEqual(app.json('analyze(state.sessions,"tudo").list.map(function(s){return s.prs})'), [[], ['5000']]);
  assert.equal(app.json('buildSummaryCore().recDaysE'), 0);
  assert.match(ajuda(app), /primeira vez numa distância aparece no treino com o selo de recorde, mas não conta em Dias com recorde/);
});

// ───────────────────────── Sequência e semana pausada ─────────────────────────
function semanas(pares) { // [['2026-10-04', 2], ...] domingo da semana e nº de corridas
  const out = [];
  pares.forEach(([dom, n]) => { for (let i = 0; i < n; i++) { const d = new Date(dom + 'T12:00:00'); d.setDate(d.getDate() + 1 + i * 2); out.push(act({ start: d.toISOString().slice(0, 10), km: 4 })); } });
  return out;
}

test('sequência: semanas seguidas com 2 corridas; a semana atual incompleta não zera', () => {
  const app = loadApp(HOJE);
  app.setActivities(semanas([['2026-10-11', 2], ['2026-10-18', 3], ['2026-10-25', 2], ['2026-11-01', 2], ['2026-11-08', 0]]));
  const st = app.json('streakInfo(state.sessions)');
  assert.equal(st.current, 4);
  assert.equal(st.thisWeek, 0);
});

test('corrida com menos de 1 km e menos de 10 min (aquecimento) não conta na semana', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ start: '2026-11-03', km: 0.6, time: 300 }), act({ start: '2026-11-04', km: 0.8, time: 620 }), act({ start: '2026-11-05', km: 1, time: 400 })]);
  assert.equal(app.json('streakInfo(state.sessions).weeks.slice(-2)[0].n'), 2);
});

test('semana pausada com menos de 2 corridas: não conta e não quebra a sequência', () => {
  const app = loadApp(HOJE);
  const A = semanas([['2026-10-11', 2], ['2026-10-18', 2], ['2026-10-25', 1], ['2026-11-01', 2]]);
  app.setActivities(A);
  assert.equal(app.json('streakInfo(state.sessions).current'), 1, 'sem pausa, a semana de 25/10 quebra');
  app.setActivities(A, { pauses: { '2026-10-25': 'atestado' } });
  const st = app.json('streakInfo(state.sessions)');
  assert.equal(st.current, 3);
  assert.equal(st.best.len, 3);
});

test('semana pausada que chegou a 2 corridas conta normal', () => {
  const app = loadApp(HOJE);
  app.setActivities(semanas([['2026-10-18', 2], ['2026-10-25', 2], ['2026-11-01', 2]]), { pauses: { '2026-10-25': 'viagem' } });
  assert.equal(app.json('streakInfo(state.sessions).current'), 3);
});

test('constância do placar: semana pausada fica de fora das 12; a semana atual só entra com 2 corridas', () => {
  const app = loadApp(HOJE);
  const pares = [];
  for (let i = 13; i >= 1; i--) { const d = new Date('2026-11-08T12:00:00'); d.setDate(d.getDate() - 7 * i); pares.push([d.toISOString().slice(0, 10), i === 2 ? 0 : 2]); }
  app.setActivities(semanas(pares), { pauses: { '2026-10-25': 'atestado' } });
  assert.equal(app.json('buildSummaryCore().act12'), 12, 'pula a pausada e busca a 13ª semana para trás');
  app.setActivities(semanas(pares));
  assert.equal(app.json('buildSummaryCore().act12'), 11);
});

test('[E1] mês fechado fica congelado: pausa, tempo oficial ou treino editado depois não mudam o resultado', () => {
  const app = loadApp(HOJE);
  const s = (o) => ({ v: 11, month: '2026-10', rec: 0, ag: 40, trot90: 600, beatsM: 0, act12: 11, medals: 2, recDaysM: 0, kmMonth: 30, daysMonth: 9, ...o });
  const grupo = (lucas, lidi) => `[{id:1,name:"Lucas",s:{hist:{"2026-10":${JSON.stringify(lucas)}}}},{id:2,name:"Lidiane",s:{hist:{"2026-10":${JSON.stringify(lidi)}}}}]`;
  // todos publicaram outubro: fecha (Lidiane vence a linha de constância)
  assert.equal(app.ev(`closeMonths(${grupo(s({ act12: 11 }), s({ act12: 12, ag: 39 }))}, "2026-11")`), true);
  const fechado = app.json('[groupHist["2026-10"], groupOrder["2026-10"], groupClosed["2026-10"]]');
  assert.deepEqual(fechado, [{ 1: 3, 2: 1 }, ['1', '2'], 1]);
  // em novembro Lucas pausa uma semana de outubro e a constância dele vira 12; Lidiane digita tempo oficial e o nível sobe
  assert.equal(app.ev(`closeMonths(${grupo(s({ act12: 12 }), s({ act12: 12, ag: 45 }))}, "2026-11")`), false);
  assert.deepEqual(app.json('[groupHist["2026-10"], groupOrder["2026-10"], groupClosed["2026-10"]]'), fechado);
});

test('[E1] o mês só fecha quando todos do grupo publicaram o fechamento; até lá não congela', () => {
  const app = loadApp(HOJE);
  const h = '{v:11,month:"2026-10",rec:0,ag:40,act12:11,medals:2,beatsM:0,recDaysM:0}';
  assert.equal(app.ev(`closeMonths([{id:1,name:"A",s:{hist:{"2026-10":${h}}}},{id:2,name:"B",s:{hist:{}}}], "2026-11")`), false);
  assert.equal(app.json('groupClosed["2026-10"] || 0'), 0);
});

test('[E1] meses gravados antes da regra (junho a outubro) ficam como estão; o mês atual continua aberto', () => {
  const app = loadApp(HOJE);
  assert.deepEqual(app.json('legacyClosed({"2026-06":{},"2026-10":{},"2026-11":{}})'), { '2026-06': 1, '2026-10': 1 });
  app.ev('groupHist={"2026-10":{"1":9,"2":7}}; groupOrder={"2026-10":["1","2"]}; groupClosed=legacyClosed(groupHist)');
  const h = (ag) => `{v:11,month:"2026-10",rec:0,ag:${ag},act12:1,medals:0,beatsM:0,recDaysM:0}`;
  app.ev(`closeMonths([{id:1,name:"A",s:{hist:{"2026-10":${h(10)}}}},{id:2,name:"B",s:{hist:{"2026-10":${h(50)}}}}], "2026-11")`);
  assert.deepEqual(app.json('groupHist["2026-10"]'), { 1: 9, 2: 7 });
});

test('[E1] o resumo de um mês passado ainda acompanha os dados enquanto o mês não fecha (dá pra acertar o tempo oficial)', () => {
  const app = loadApp(HOJE);
  const pares = [];
  for (let i = 14; i >= 1; i--) { const d = new Date('2026-11-08T12:00:00'); d.setDate(d.getDate() - 7 * i); pares.push([d.toISOString().slice(0, 10), i === 3 ? 1 : 2]); }
  const A = semanas(pares);
  app.setActivities(A);
  assert.equal(app.json('buildSummary().hist["2026-10"].act12'), 11);
  app.setActivities(A, { pauses: { '2026-10-18': 'viagem' } });
  assert.equal(app.json('buildSummary().hist["2026-10"].act12'), 12);
});

// ───────────────────────── Metas ─────────────────────────
test('meta: 5% a 7% abaixo da base; bate com o tempo mais lento da faixa', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'a', start: '2026-10-01', km: 5, time: 3000, race: true })], { efforts: { a: eff({ 5000: 3000 }) } });
  app.ev('maybeUpdateGoal()');
  const g = app.json('GOALS["5000"]');
  assert.deepEqual([g.lo, g.hi, g.baseT], [2790, 2850, 3000]);
});

test('meta de 5 km: treino na rua com prova há menos de 6 semanas não bate; prova bate', () => {
  const app = loadApp('2026-10-10T10:00:00');
  const A = [act({ id: 'a', start: '2026-09-20', km: 5, time: 3000, race: true })], E = { a: eff({ 5000: 3000 }) };
  app.setActivities(A, { efforts: E }); app.ev('maybeUpdateGoal()');
  const G = () => JSON.stringify(app.json('GOALS'));
  let g = G();
  A.push(act({ id: 'b', start: '2026-10-05', km: 5, time: 2800 })); E.b = eff({ 5000: 2800 });
  app.setActivities(A, { efforts: E }); app.ev(`GOALS=${g};GOAL=getGoal(goalK);maybeUpdateGoal()`);
  assert.equal(app.json('GOALS["5000"].history.length'), 0);
  assert.equal(app.json('goalState("5000").trainOnly'), true);
  g = G();
  A.push(act({ id: 'c', start: '2026-10-09', km: 5, time: 2840, race: true })); E.c = eff({ 5000: 2840 });
  app.setActivities(A, { efforts: E }); app.ev(`GOALS=${g};GOAL=getGoal(goalK);maybeUpdateGoal()`);
  assert.equal(app.json('GOALS["5000"].history.length'), 1);
  assert.equal(app.json('GOALS["5000"].baseT'), 2840);
});

test('meta de 1 a 4 km: treino na rua bate; esteira nunca bate', () => {
  const app = loadApp(HOJE);
  const A = [act({ id: 'a', start: '2026-10-20', km: 3, time: 1500 })], E = { a: eff({ 3000: 1500 }) };
  app.setActivities(A, { efforts: E }); app.ev('maybeUpdateGoal()');
  let g = JSON.stringify(app.json('GOALS'));
  A.push(act({ id: 'e', start: '2026-11-02', km: 3, time: 1300, latlng: null })); E.e = eff({ 3000: 1300 });
  app.setActivities(A, { efforts: E }); app.ev(`GOALS=${g};GOAL=getGoal(goalK);maybeUpdateGoal()`);
  assert.equal(app.json('GOALS["3000"].history.length'), 0, 'esteira não vale');
  g = JSON.stringify(app.json('GOALS'));
  A.push(act({ id: 'r', start: '2026-11-04', km: 3, time: 1420 })); E.r = eff({ 3000: 1420 });
  app.setActivities(A, { efforts: E }); app.ev(`GOALS=${g};GOAL=getGoal(goalK);maybeUpdateGoal()`);
  assert.equal(app.json('GOALS["3000"].history.length'), 1);
});

test('[E2] a tela de Metas e o placar contam as mesmas metas batidas: treino feito dentro das 6 semanas nunca passa a valer', () => {
  // Prova em 01/09 (50:00). Treino de rua em 20/09 em 46:40, 19 dias depois da prova: não vale.
  const app = loadApp('2026-09-25T10:00:00');
  const A = [act({ id: 'a', start: '2026-09-01', km: 5, time: 3000, race: true }), act({ id: 'b', start: '2026-09-20', km: 5, time: 2800 })];
  const E = { a: eff({ 5000: 3000 }), b: eff({ 5000: 2800 }) };
  app.setActivities([A[0]], { efforts: E }); app.ev('maybeUpdateGoal()');
  const g = JSON.stringify(app.json('GOALS'));
  app.setActivities(A, { efforts: E }); app.ev(`GOALS=${g};GOAL=getGoal(goalK);maybeUpdateGoal()`);
  assert.equal(app.json('GOALS["5000"].history.length'), 0);
  // 49 dias depois da prova, sem nenhum treino novo: só o tempo passou.
  app.setNow('2026-10-20T10:00:00');
  app.ev('maybeUpdateGoal()');
  const tela = app.json('GOALS["5000"].history.length');
  const placar = app.json('buildSummaryCore().beats');
  assert.equal(tela, placar, `a tela registrou ${tela} meta batida (com data de 20/09) e subiu a meta sozinha; o placar conta ${placar}`);
  assert.equal(tela, 0);
  assert.equal(app.json('GOALS["5000"].hi'), 2850, 'a meta não sobe sozinha');
  assert.equal(app.json('goalState("5000").trainOnly'), true, 'a tela segue dizendo "em treino, falta na prova"');
});

test('[E2] treino de 5 km na rua vale quando, no dia dele, já fazia 42 dias ou mais da última prova', () => {
  const app = loadApp('2026-11-09T10:00:00');
  const A = [act({ id: 'a', start: '2026-09-01', km: 5, time: 3000, race: true }), act({ id: 'b', start: '2026-10-12', km: 5, time: 2840 }), act({ id: 'c', start: '2026-10-13', km: 5, time: 2690 })];
  app.setActivities(A, { efforts: { a: eff({ 5000: 3000 }), b: eff({ 5000: 2840 }), c: eff({ 5000: 2690 }) } });
  app.ev('maybeUpdateGoal()');
  // 12/10 = 41 dias depois da prova: não vale. 13/10 = 42 dias: vale (meta de 47:30).
  assert.deepEqual(app.json('GOALS["5000"].history.map(function(h){return [h.date,h.t,h.kind]})'), [['2026-10-13', 2690, 'treino']]);
  assert.equal(app.json('buildSummaryCore().beats'), 1);
});

test('[E3] quem entra com histórico: a meta da tela e a do placar partem da mesma base (o primeiro tempo)', () => {
  const app = loadApp('2026-10-10T10:00:00');
  const A = [act({ id: 'a', start: '2026-08-01', km: 5, time: 3000, race: true }), act({ id: 'b', start: '2026-09-01', km: 5, time: 2900, race: true })];
  const E = { a: eff({ 5000: 3000 }), b: eff({ 5000: 2900 }) };
  app.setActivities(A, { efforts: E }); app.ev('maybeUpdateGoal()'); // primeiro acesso: base = 1º tempo (50:00), meta 47:30
  assert.deepEqual(app.json('[GOALS["5000"].baseT, GOALS["5000"].hi]'), [3000, 2850]);
  const g = JSON.stringify(app.json('GOALS'));
  A.push(act({ id: 'c', start: '2026-10-08', km: 5, time: 2800, race: true })); E.c = eff({ 5000: 2800 }); // 46:40
  app.setActivities(A, { efforts: E }); app.ev(`GOALS=${g};GOAL=getGoal(goalK);maybeUpdateGoal()`);
  const tela = app.json('GOALS["5000"].history.length');
  const placar = app.json('buildSummaryCore().beatsM');
  assert.equal(placar, tela);
  assert.equal(tela, 1, 'a prova de 46:40 bate a meta de 47:30 nos dois');
});

test('[E8] "Metas batidas" conta as metas de 1 a 6 km e a de 10 km, e a ajuda diz isso', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'a', start: '2026-09-01', km: 10, time: 6000, race: true }), act({ id: 'b', start: '2026-11-03', km: 10, time: 5600, race: true })],
    { efforts: { a: eff({ 10000: 6000 }), b: eff({ 10000: 5600 }) } });
  assert.equal(app.json('buildSummaryCore().beatsM'), 1);
  assert.match(ajuda(app), /meta de 1 a 6 km ou de 10 km/);
});

// ───────────────────────── Medalhas ─────────────────────────
test('faixas de km: ouro = média dos 3 meses anteriores (mínimo 10), bronze 60%, prata 80%, diamante +40%', () => {
  const app = loadApp(HOJE);
  assert.deepEqual(app.json('tiersFrom(10)'), [6, 8, 10, 14]);
  assert.deepEqual(app.json('tiersFrom(42.5)'), [26, 34, 43, 60]);
  app.setActivities([act({ start: '2026-08-10', km: 30 }), act({ start: '2026-09-10', km: 40 }), act({ start: '2026-10-10', km: 50 })]);
  assert.deepEqual(app.json('kmTiers(monthStats(), "2026-11")'), [24, 32, 40, 56]);
  assert.deepEqual(app.json('kmTiers(monthStats(), "2026-08")'), [6, 8, 10, 14], 'sem histórico, vale o mínimo');
});

test('faixas de dias: mínimo 8; o diamante nunca passa do mês menos um descanso por semana', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ start: '2026-11-01' })]);
  assert.deepEqual(app.json('daysTiers(monthStats(), "2026-11")'), [5, 7, 8, 12]);
  assert.deepEqual(app.json('tiersFrom(30, 26)'), [18, 24, 25, 26], 'quem treina todo dia: ouro em 25, diamante em 26 de 30');
});

test('medalhas somam bronze 1, prata 2, ouro 3, diamante 4; caminhada não soma km mas conta dia ativo', () => {
  const app = loadApp(HOJE);
  const A = [];
  for (let d = 1; d <= 8; d++) A.push(act({ start: '2026-11-0' + d, km: d <= 2 ? 5 : 0.9, time: 700 }));
  A.push(act({ start: '2026-11-09', km: 3, time: 1800, type: 'Walk' }));
  app.setActivities(A);
  const s = app.json('buildSummaryCore()');
  assert.equal(s.daysMonth, 9);
  assert.equal(s.kmMonth, 15.4);
  assert.equal(s.daysTier, 2); // ouro (8)
  assert.equal(s.kmTier, 3); // diamante (14)
  assert.equal(s.medals, 7);
});

test('[E14] ajuda descreve o dia ativo: qualquer corrida conta; outra atividade só com 10 minutos ou mais', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ start: '2026-11-05', km: 0.6, time: 300 }), act({ start: '2026-11-06', km: 0.5, time: 420, type: 'Walk' }), act({ start: '2026-11-07', km: 1, time: 600, type: 'Ride' })]);
  assert.equal(app.json('monthStats().days["2026-11"]'), 2, 'corrida de 5 min e pedal de 10 min contam; caminhada de 7 min não');
  assert.match(ajuda(app), /qualquer corrida, de qualquer duração, e qualquer outra atividade de 10 minutos ou mais/);
});

// ───────────────────────── Placar ─────────────────────────
test('placar: em cada linha, os pontos dela por pessoa superada; empate não dá ponto', () => {
  const app = loadApp(HOJE);
  const base = { v: 11, month: '2026-11', rec: 5, ag: 40, trot90: 600, beatsM: 1, act12: 10, medals: 4, recDaysE: 2 };
  const pts = app.ev(`JSON.stringify(scoreBoard([
    {id:1,s:${JSON.stringify(base)}},
    {id:2,s:${JSON.stringify({ ...base, rec: 3, ag: 45 })}},
    {id:3,s:${JSON.stringify({ ...base, rec: 3, ag: 30, medals: 6 })}}], "2026-11"))`);
  // rec (4): 1 supera 2 e 3 = 8. ag (3): 2 supera 1 e 3 = 6; 1 supera 3 = 3. medalhas (1): 3 supera 1 e 2 = 2.
  assert.deepEqual(JSON.parse(pts), { 1: 11, 2: 6, 3: 2 });
});

test('placar: quem não tem valor numa linha conta como último; resumo de versão antiga fica fora da linha', () => {
  const app = loadApp(HOJE);
  const pts = JSON.parse(app.ev(`JSON.stringify(scoreBoard([
    {id:1,s:{v:11,month:"2026-11",rec:0,ag:null,trot90:null,beatsM:0,act12:0,medals:0,recDaysE:0}},
    {id:2,s:{v:11,month:"2026-11",rec:null,ag:null,trot90:null,beatsM:0,act12:0,medals:0,recDaysE:0}},
    {id:3,s:{v:8,month:"2026-11",rec:9,ag:50,trot90:900,beatsM:0,act12:5,medals:0}}], "2026-11"))`));
  assert.equal(pts[1], 4, '0% de melhora supera quem não tem 5 km');
  assert.equal(pts[2], 0);
  assert.equal(pts[3], 2 * (4 + 3 + 3 + 1), 'resumo v8 supera os dois em rec, ag, trot e constância; fica fora de metas e recordes (linhas v9/v11)');
});

test('desempate do mês no grupo: nível, linhas vencidas sozinho, km, dias ativos', () => {
  const app = loadApp(HOJE);
  const ordem = app.json(`(function(){
    var p=[{id:1,s:{v:11,month:"2026-11",ag:40,kmMonth:30,daysMonth:9}},{id:2,s:{v:11,month:"2026-11",ag:40,kmMonth:35,daysMonth:9}},{id:3,s:{v:11,month:"2026-11",ag:41,kmMonth:1,daysMonth:1}}];
    return rankBoard(p,{1:5,2:5,3:5},"2026-11").map(function(r){return [r.p.id,r.pos]});})()`);
  assert.deepEqual(ordem, [[3, 1], [2, 2], [1, 3]]);
});

test('[E15] empate total no mês é empate: ninguém ganha o mês', () => {
  const app = loadApp(HOJE);
  const igual = '{v:11,month:"2026-10",rec:0,ag:40,act12:5,medals:0,beatsM:0,recDaysM:0,kmMonth:20,daysMonth:8}';
  app.ev(`closeMonths([{id:1,name:"A",s:{hist:{"2026-10":${igual}}}},{id:2,name:"B",s:{hist:{"2026-10":${igual}}}}], "2026-11")`);
  assert.deepEqual(app.json('monthWinner("2026-10", groupHist["2026-10"])').sort(), ['1', '2']);
  assert.match(ajuda(app), /o mês fica empatado e ninguém ganha o mês/);
});

test('[E15] empate nos pontos resolvido pelo desempate continua tendo um vencedor', () => {
  const app = loadApp(HOJE);
  const h = (ag) => `{v:11,month:"2026-10",rec:${ag === 41 ? 0 : 1},ag:${ag},trot90:${ag === 41 ? 700 : 600},act12:5,medals:${ag === 41 ? 1 : 0},beatsM:0,recDaysM:0}`;
  app.ev(`closeMonths([{id:1,name:"A",s:{hist:{"2026-10":${h(40)}}}},{id:2,name:"B",s:{hist:{"2026-10":${h(41)}}}}], "2026-11")`);
  assert.deepEqual(app.json('groupHist["2026-10"]'), { 1: 4, 2: 7 });
  assert.deepEqual(app.json('monthWinner("2026-10", groupHist["2026-10"])'), ['2']);
});

// ───────────────────────── Treinos juntos ─────────────────────────
const lidi = (runs) => ({ id: 2, firstname: 'Lidiane', summary: { v: 11, runs, runsAll: runs } });
const juntos = (app, nome) => app.json(`togetherCount(buildSummaryCore().runs, group[0].summary.runs, "Lucas", ${JSON.stringify(nome || 'Lidiane')})`);

test('juntos na rua: até 20 min de diferença e largada no mesmo lugar', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00' })], { group: [lidi(['2026-11-05T06:12|-9.66,-35.71'])] });
  assert.equal(juntos(app), 1);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00' })], { group: [lidi(['2026-11-05T06:21|-9.66,-35.71'])] });
  assert.equal(juntos(app), 0, '21 minutos');
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00' })], { group: [lidi(['2026-11-05T06:05|-9.60,-35.71'])] });
  assert.equal(juntos(app), 0, 'outro bairro');
});

test('juntos na esteira, mesmo horário e sem nome na descrição: não conta (academias diferentes)', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: null })], { group: [lidi(['2026-11-05T06:05|i'])] });
  assert.equal(juntos(app), 0);
});

test('juntos só com o nome na descrição (esteira): conta, com acento, maiúscula e emoji', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: null })],
    { group: [lidi(['2026-11-05T06:05|i'])], descs: { 1: 'Treino B com a LIDIANE 💪' } });
  assert.deepEqual(app.json('buildSummaryCore().runs'), ['2026-11-05T06:00|i|n=lidiane']);
  assert.equal(juntos(app), 1);
});

test('juntos: o nome na descrição da OUTRA pessoa também vale', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: null })], { group: [lidi(['2026-11-05T06:05|i|n=lucas'])] });
  assert.equal(juntos(app), 1);
});

test('juntos: nome dentro de outra palavra não conta ("Lucasville")', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: null })],
    { group: [{ id: 3, firstname: 'Ana', summary: { v: 11, runs: ['2026-11-05T06:05|i'] } }], descs: { 1: 'treino na savana' } });
  assert.equal(juntos(app, 'Ana'), 0);
});

test('[E4] nome escrito na descrição depois: o app relê a descrição vazia, no máximo uma vez por dia, até a corrida ter 14 dias', async () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '10', start: '2026-11-05T06:00:00', latlng: null }), act({ id: '11', start: '2026-10-20T06:00:00', latlng: null })],
    { group: [lidi(['2026-11-05T06:05|i', '2026-10-20T06:05|i'])] });
  app.ev(`globalThis.__desc = ""; globalThis.__ids = []; db = true; session = "x";
    apiFetch = function(p){ var ids = p.split("=")[1].split(","), o = {}; ids.forEach(function(i){ globalThis.__ids.push(i); o[i] = i === "10" ? globalThis.__desc : ""; }); return Promise.resolve({ descs: o }); };
    putDoc = function(c, i, d){ if (i === "descs") globalThis.__saved = JSON.stringify(d); }; publishSummary = function(){}; render = function(){};`);
  const roda = async () => { app.ev('ensureDescs()'); await tick(); await tick(); await tick(); return app.json('globalThis.__ids.splice(0)').sort(); };
  assert.deepEqual(await roda(), ['10', '11'], 'primeira leitura: as duas vazias');
  app.ev('globalThis.__desc = "com Lidiane"'); // a pessoa escreveu o nome no Strava
  assert.deepEqual(await roda(), [], 'no mesmo dia não busca de novo');
  app.setNow('2026-11-10T17:30:00');
  assert.deepEqual(await roda(), ['10'], 'no dia seguinte relê a de 05/11; a de 20/10 tem mais de 14 dias e fica quieta');
  assert.equal(app.json('DESCS["10"]'), 'com Lidiane');
  assert.equal(juntos(app), 1);
  app.setNow('2026-11-12T17:30:00');
  assert.deepEqual(await roda(), [], 'descrição preenchida não é mais buscada');
  assert.deepEqual(Object.keys(JSON.parse(app.ev('globalThis.__saved')).t), [], 'só guarda a hora de leitura das vazias recentes');
});

test('[E9] sobrenome do Strava vale quando só uma pessoa do grupo tem: "Felipe" acha o Luiz; "Batinga", que é de dois, não acha ninguém', () => {
  const app = loadApp(HOJE);
  const luiz = (runs) => ({ id: 3, firstname: 'Luiz', lastname: 'Felipe Batinga', summary: { v: 11, runs } });
  const caso = (desc) => {
    app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: null })],
      { me: { id: 1, firstname: 'Lucas', lastname: 'Batinga' }, group: [luiz(['2026-11-05T06:05|i'])], descs: { 1: desc } });
    return juntos(app, 'Luiz');
  };
  assert.equal(caso('Treino com Felipe'), 1);
  assert.equal(caso('Treino com o Luiz'), 1);
  assert.equal(caso('Treino dos Batinga'), 0);
  assert.equal(caso('felipeta'), 0, 'só a palavra inteira');
  assert.deepEqual(app.json('buildSummaryCore().runs'), ['2026-11-05T06:00|i'], 'sem nome, sem marca');
  caso('com Felipe');
  assert.deepEqual(app.json('buildSummaryCore().runs'), ['2026-11-05T06:00|i|n=luiz'], 'a marca publicada leva sempre o primeiro nome, que é o que os outros apps procuram');
});

test('[E9] sem sobrenome vindo do servidor (função ainda não publicada), vale só o primeiro nome, como antes', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: null })],
    { group: [{ id: 3, firstname: 'Luiz', summary: { v: 11, runs: ['2026-11-05T06:05|i'] } }], descs: { 1: 'Treino com Felipe' } });
  assert.equal(juntos(app, 'Luiz'), 0);
});

test('[E10] ajuda descreve a regra de lugar: quadrados de cerca de 1 km (1,1 km pode ficar de fora, 2,2 km pode entrar)', () => {
  const app = loadApp(HOJE);
  const caso = (a, b) => {
    const r = (x) => (Math.round(x * 100) / 100).toFixed(2);
    app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: [Number(r(a)), -35.71] })], { group: [lidi(['2026-11-05T06:05|' + r(b) + ',-35.71'])] });
    return juntos(app);
  };
  assert.equal(caso(-9.6601, -9.6690), 1, '1,0 km: conta');
  assert.equal(caso(-9.6649, -9.6751), 0, '1,13 km em quadrados não vizinhos');
  assert.equal(caso(-9.6551, -9.6749), 1, '2,20 km em quadrados vizinhos');
  assert.equal(caso(-9.6500, -9.6800), 0, '3,3 km: nunca');
  assert.match(ajuda(app), /quadrados de cerca de 1 km/);
});

test('[E11] ajuda descreve "Primeira com alguém": o nome na descrição basta, mesmo sem corrida da outra pessoa', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '1', start: '2026-11-05T06:00:00', latlng: null })], { group: [lidi([])], descs: { 1: 'saudade de correr com a Lidiane' } });
  assert.equal(app.ev('!!firstTogether(state.sessions, [], "Lidiane", group[0])'), true);
  assert.match(ajuda(app), /mesmo que ela não tenha gravado a dela/);
});

// ───────────────────────── Robustez ─────────────────────────
test('[E13] gravação que o Strava não devolve: uma busca só, e de novo no máximo uma vez por dia', async () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '77', start: '2026-11-05', latlng: null })], { efforts: { 77: { v: 4, efforts: { 1000: 400 }, trot: { t: 0, m: 0 } } } });
  app.ev(`globalThis.__n = 0; render = function(){}; saveDoc = async function(id, doc){ effortDocs[id] = doc; };
    mcp = { callTool: function(){ globalThis.__n++; return Promise.reject({ code: globalThis.__n > 6 ? "no_session" : "tool_error" }); } }; kick();`);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(app.ev('globalThis.__n'), 1, 'cada volta gastava uma leitura do limite do Strava, que é dividido por todo mundo');
  assert.deepEqual(app.json('effortDocs["77"].efforts'), { 1000: 400 }, 'os trechos antigos continuam valendo');
  app.ev('kick()'); await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.ev('globalThis.__n'), 1, 'abrir o app de novo no mesmo dia não busca');
  app.setNow('2026-11-10T17:30:00');
  app.ev('kick()'); await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.ev('globalThis.__n'), 2, 'um dia depois, uma tentativa nova');
});

test('[E13] erro inesperado do Strava (500) numa gravação também espera um dia', async () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: '78', start: '2026-11-05', latlng: null })], { efforts: { 78: { v: 4, efforts: { 1000: 400 }, trot: { t: 0, m: 0 } } } });
  app.ev(`globalThis.__n = 0; render = function(){}; saveDoc = async function(id, doc){ effortDocs[id] = doc; };
    mcp = { callTool: function(){ globalThis.__n++; return Promise.reject({ code: "upstream_error" }); } }; kick();`);
  await new Promise((r) => setTimeout(r, 50));
  app.ev('skipIds = {}; kick()'); await new Promise((r) => setTimeout(r, 50)); // "Atualizar" limpa a lista de pulados
  assert.equal(app.ev('globalThis.__n'), 1);
});

// ───────────────────────── Telas (revisão de 10/11/2026) ─────────────────────────
test('[A3] prova cadastrada sem tempo oficial: tempo total ÷ distância oficial em todas as telas', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'p', start: '2026-10-31', km: 5.04, time: 2338, elapsed: 2352, race: true })], {
    efforts: { p: eff({ 5000: 2330 }) }, races: [{ date: '2026-10-31', name: 'Estações', km: 5 }],
  });
  assert.equal(tabela(app, 'rua', '5000')[0].t, 2352);
  const s = app.json('(function(){var s=state.sessions[0];return {km:s.km,time:s.time,pace:Math.floor(s.pace),watch:s.watchKm}})()');
  assert.deepEqual(s, { km: 5, time: 2352, pace: 470, watch: 5.04 });
  assert.equal(app.ev('fmtPace(state.sessions[0].pace)'), '7min50s');
  assert.equal(app.json('analyze(state.sessions,"rua").best.pace5.id'), 'p');
});

test('[A3] relógio parou antes (mais de 2% curto): a prova fica com a distância do relógio', () => {
  const app = loadApp(HOJE);
  app.setActivities([act({ id: 'p', start: '2026-10-31', km: 3.2, time: 1500, race: true })], { races: [{ date: '2026-10-31', name: 'Estações', km: 5 }] });
  tabela(app, 'rua', '5000');
  assert.equal(app.json('state.sessions[0].km'), 3.2);
});

test('[M1][M2][B2][B4] formatos: segundos sozinhos, km com 2 casas cortadas, meia maratona, tempo oficial por extenso', () => {
  const app = loadApp(HOJE);
  assert.equal(app.ev('fmtTime(35.9)'), '35s');
  assert.equal(app.ev('fmtTime(60)'), '1min00s');
  assert.equal(app.ev('fmtKm(3)'), '3,00');
  assert.equal(app.ev('fmtKm(4.996)'), '4,99');
  assert.equal(app.ev('fmtKmShort(21.0975)'), '21,1');
  assert.equal(app.ev('fmtKmShort(5)'), '5');
  assert.equal(app.ev('parseChip("52min18s")'), 3138);
  assert.equal(app.ev('parseChip("1h02min03s")'), 3723);
  assert.equal(app.ev('parseChip("29:15,72")'), 1755.72);
  assert.equal(app.ev('fmtChip(1755.72)'), '29min15,72s');
  assert.equal(app.ev('parseChip(fmtChip(4008.57))'), 4008.57);
});
