// Regras do Treino do dia (treino.html), conferidas contra o plano de treinos do projeto Corpo.
// Os testes marcados com [T1], [T2]... são erros encontrados na revisão de 12/11/2026, já corrigidos.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTreino } = require('./treino-harness');

const HOJE = '2026-11-10T08:00:00';
const BASE = { rests: { '2026-11-09': true } }; // o descanso de segunda, 09/11
const linha = (p, de, ate) => Object.keys(p).sort().filter((d) => d >= de && d <= ate).map((d) => p[d]).join(' ');
const corrida = (km) => [{ d: '2026-11-21', name: 'Prova', km }];

test('agenda até a Santander bate com a tabela do plano', () => {
  const p = loadTreino(HOJE, BASE).plan('2026-11-28');
  assert.equal(linha(p, '2026-11-09', '2026-11-28'), 'off A R L R B R auto R A3 R eve race R R L R B auto C');
});

test('ciclo L → B → forte, sempre com R ou descanso entre eles, e o forte alterna C e A', () => {
  const t = loadTreino(HOJE, { rests: BASE.rests, races: [] });
  const p = t.plan('2027-02-28'), dias = Object.keys(p).sort().filter((d) => d > '2026-11-09');
  const fortes = dias.filter((d) => /^[ABCL]$/.test(p[d]));
  fortes.forEach((d, i) => { if (i) assert.notEqual(new Date(d) - new Date(fortes[i - 1]), 86400000, 'dois treinos seguidos sem R: ' + d); });
  assert.match(fortes.map((d) => p[d]).join(''), /^C(LBALBC)*(LBA(LB)?|LB?)?$/);
});

test('no máximo 6 dias seguidos de treino; "Treinar mesmo assim" desfaz o descanso automático', () => {
  const p = loadTreino(HOJE, { rests: BASE.rests, races: [] }).plan('2027-02-28');
  let seg = 0;
  Object.keys(p).sort().filter((d) => d > '2026-11-09').forEach((d) => { seg = /^(off|auto|eve)$/.test(p[d]) ? 0 : seg + 1; assert.ok(seg <= 6, d); });
  const q = loadTreino(HOJE, { rests: BASE.rests, keep: { '2026-11-16': true } }).plan('2026-11-17');
  assert.notEqual(q['2026-11-16'], 'auto');
});

test('descanso marcado conta como R: no dia seguinte vem o próximo treino da fila', () => {
  const p = loadTreino(HOJE, { rests: { '2026-11-09': true, '2026-11-11': true } }).plan('2026-11-12');
  assert.equal(linha(p, '2026-11-10', '2026-11-12'), 'A off L');
});

test('prova de 4 a 7,9 km: ensaio nos 11 dias antes, A leve 3 dias antes, R, descanso na véspera, 2 R depois e recomeça no L', () => {
  const t = loadTreino(HOJE, BASE), p = t.plan('2026-11-24');
  assert.equal(linha(p, '2026-11-18', '2026-11-24'), 'A3 R eve race R R L');
  assert.equal(t.ev('aVariant("2026-11-10", "A")'), 'fast');
  assert.equal(t.ev('bKm("2026-11-16")'), 4); assert.equal(t.ev('bKm("2026-11-15")'), 5);
});

test('prova de 8 km ou mais: A leve 4 dias antes, 2 R, véspera, 3 R depois, L de no máximo 6 km na última semana', () => {
  const t = loadTreino(HOJE, { rests: BASE.rests, races: corrida(10) }), p = t.plan('2026-11-25');
  assert.equal(linha(p, '2026-11-17', '2026-11-25'), 'A3 R R eve race R R R L');
  assert.equal(t.ev('lPlanKm("2026-11-15", 8)'), 6); assert.equal(t.ev('lPlanKm("2026-11-13", 8)'), 8);
});

test('prova de até 3 km: só R na véspera e 1 R depois; treino segue normal, sem ensaio', () => {
  const t = loadTreino(HOJE, { rests: BASE.rests, races: corrida(3) }), p = t.plan('2026-11-22');
  assert.equal(linha(p, '2026-11-20', '2026-11-22'), 'R race R');
  assert.equal(t.ev('aVariant("2026-11-17", "A")'), 'normal');
});

test('musculação: só depois do B e do C, só depois da Santander, e sem perna nos 6 dias antes de prova', () => {
  const t = loadTreino(HOJE, { rests: BASE.rests, races: [{ d: '2026-11-21', name: 'S', km: 5 }, { d: '2026-12-13', name: 'N', km: 5 }] });
  const g = (d, tp) => t.ev(`gymOn("${d}", "${tp}")`);
  assert.equal(g('2026-11-14', 'B'), false); assert.equal(g('2026-11-26', 'B'), true); assert.equal(g('2026-11-28', 'C'), true);
  assert.equal(g('2026-11-24', 'L'), false); assert.equal(g('2026-12-05', 'A'), false);
  assert.equal(g('2026-12-07', 'B'), false); assert.equal(g('2026-12-06', 'B'), true);
});

test('joelho: o próximo forte vira R e nada sobe de degrau por 7 dias', () => {
  const t = loadTreino(HOJE, { rests: BASE.rests, races: [], cfg: { knee: { '2026-11-09': true } } });
  assert.equal(t.plan('2026-11-10')['2026-11-10'], 'Rk');
  assert.equal(t.ev('kneeOn("2026-11-15")'), '2026-11-09'); assert.equal(t.ev('kneeOn("2026-11-16")'), null);
});

// ---------- evolução automática ----------
const L = (hr, dur) => ({ L: { 0: { hr, dur } } });
const blocos = (n, hr, dur) => { const m = {}; for (let i = 0; i < n; i++) m[i] = { hr, dur }; return m; };
function semProva(extra) { return loadTreino('2026-12-20T08:00:00', Object.assign({ rests: BASE.rests, races: [] }, extra || {})); }

test('L: trote longo sobe com 2 completos seguidos (FC até 160); distância e trote longo nunca sobem no mesmo L', () => {
  const t = semProva();
  t.feitos({ '2026-11-11': L(158, 300), '2026-11-17': L(160, 300) },
    { a: { date: '2026-11-11', type: 'L', km: 5 }, b: { date: '2026-11-17', type: 'L', km: 5 } });
  const s = t.degraus('2026-11-17');
  assert.equal(s.tl, 3, 'trote longo foi de 5 para 6 min'); assert.equal(s.l, 5, 'a distância não sobe no mesmo L');
});

test('L: trote longo acima de 160 ou mais curto que o planejado é falha; 2 falhas seguidas descem um degrau', () => {
  const t = semProva();
  t.feitos({ '2026-11-11': L(165, 300), '2026-11-17': L(150, 200) }, {});
  assert.equal(t.degraus('2026-11-17').tl, 1);
});

test('A: sobe com 2 A seguidos com os 5 blocos anotados, completos e FC até 170; ensaio de prova não conta', () => {
  const t = semProva();
  t.feitos({ '2026-11-21': { A: blocos(5, 168, 180) }, '2026-12-04': { A: blocos(5, 170, 180) } }, {});
  assert.equal(t.degraus('2026-12-04').a, 1);
  const u = loadTreino(HOJE, BASE);
  u.feitos({ '2026-11-10': { A: blocos(5, 160, 180) } }, {});
  assert.deepEqual(u.degraus('2026-11-10').n.a || { ok: 0, bad: 0 }, { ok: 0, bad: 0 });
});

test('A: bloco entre 171 e 175 não sobe nem desce; acima de 175 ou bloco cortado é falha', () => {
  const t = semProva();
  t.feitos({ '2026-11-21': { A: blocos(5, 168, 180) }, '2026-12-04': { A: blocos(5, 173, 180) } }, {});
  assert.equal(t.degraus('2026-12-04').a, 0);
  const u = semProva();
  u.feitos({ '2026-11-21': { A: blocos(5, 178, 180) }, '2026-12-04': { A: blocos(3, 160, 100) } }, { x: { date: '2026-12-04', type: 'A' } });
  assert.deepEqual(u.degraus('2026-12-04').n.a, { ok: 0, bad: 2 }); // já está no primeiro degrau: não tem pra onde descer
});

test('C: 6 tiros a 9,0 → 7 tiros depois de 2 C completos', () => {
  const t = semProva();
  t.feitos({ '2026-11-15': { C: blocos(6, 165, 30) }, '2026-11-28': { C: blocos(6, 169, 30) } }, {});
  assert.deepEqual(t.json('C_ST[replay("2026-11-28").c]'), [7, 9]);
});

test('R: base sobe 1% com 3 R seguidos com FC média até 125 e desce com 2 acima de 140, entre 2% e 4%', () => {
  const t = semProva();
  t.feitos({}, { a: { date: '2026-11-12', type: 'R', hr: 120 }, b: { date: '2026-11-14', type: 'R', hr: 125 }, c: { date: '2026-11-16', type: 'R', hr: 124 } });
  assert.equal(t.degraus('2026-11-16').r, 4);
  const u = semProva();
  u.feitos({}, { a: { date: '2026-11-12', type: 'R', hr: 141 }, b: { date: '2026-11-14', type: 'R', hr: 150 } });
  assert.equal(u.degraus('2026-11-14').r, 2);
});

test('joelho segura a subida: 2 L completos dentro dos 7 dias não sobem o trote longo', () => {
  const t = semProva({ cfg: { knee: { '2026-11-11': true } } });
  t.feitos({ '2026-11-12': L(150, 300), '2026-11-17': L(150, 300) }, {});
  assert.equal(t.degraus('2026-11-17').tl, 2);
});

test('fase 2 começa quando um trote longo anotado passa de 5 km', () => {
  const t = semProva();
  t.feitos({ '2026-11-11': L(155, 47 * 60) }, {});
  assert.equal(t.degraus('2026-11-11').p2, true);
});

// ---------- erros encontrados na revisão de 12/11/2026 ----------
test('[T1] duas provas com 1 ou 2 dias de diferença: a segunda tem que aparecer como prova', () => {
  const p = loadTreino(HOJE, { rests: BASE.rests, races: [{ d: '2026-11-21', name: 'S', km: 5 }, { d: '2026-11-23', name: 'X', km: 5 }] }).plan('2026-11-23');
  assert.equal(p['2026-11-23'], 'race', 'o dia 23/11 aparece como ' + p['2026-11-23']);
});

test('[T2] "a semana da prova não muda": o descanso automático não pode tirar o A leve de 3 dias antes', () => {
  const p = loadTreino(HOJE, { rests: { '2026-11-09': true, '2026-11-11': true } }).plan('2026-11-21');
  assert.equal(p['2026-11-18'], 'A3', 'em 18/11 aparece ' + p['2026-11-18']);
  assert.equal(p['2026-11-17'], 'auto', 'o descanso do 7º dia vem um dia antes');
});

test('[T3] joelho anotado no dia do forte: o próximo forte vira R mesmo quando cai 7 dias depois (semana com descanso automático)', () => {
  const p = loadTreino(HOJE, { rests: BASE.rests, cfg: { knee: { '2026-11-28': true } } }).plan('2026-12-05');
  assert.equal(p['2026-12-05'], 'Rk', 'o forte de 05/12 continua ' + p['2026-12-05']);
});

test('[T4] L de 4,5 km num dia de 5 km não conta como distância completa', () => {
  const t = loadTreino(HOJE, BASE);
  const r = t.json('analyze("L", {}, {distance: 4500, moving_time: 2800}, "2026-11-12")');
  assert.ok(r.km < 5, 'o Strava marcou 4,5 km e a página guardou ' + r.km + ' km');
});

test('[T1] véspera da segunda prova é descanso, mesmo dentro da recuperação da primeira', () => {
  const p = loadTreino(HOJE, { rests: BASE.rests, races: [{ d: '2026-11-21', name: 'S', km: 5 }, { d: '2026-11-23', name: 'X', km: 5 }] }).plan('2026-11-25');
  assert.equal(linha(p, '2026-11-20', '2026-11-25'), 'eve race eve race R R');
});

test('[T3] joelho antigo (mais de 14 dias) não mexe mais na agenda', () => {
  const p = loadTreino(HOJE, { rests: BASE.rests, cfg: { knee: { '2026-11-12': true } } }).plan('2026-11-28');
  assert.equal(p['2026-11-28'], 'C');
});

test('[T4] L de 4,9 km num dia de 5 km conta; 5,4 km continua 5', () => {
  const t = loadTreino(HOJE, BASE), km = (m) => t.json('analyze("L", {}, {distance: ' + m + '}, "2026-11-12")').km;
  assert.deepEqual([km(4900), km(4899), km(5400), km(5000)], [5, 4, 5, 5]);
});

test('descanso automático não cai colado na véspera de prova: o R de 2 dias antes fica (no máximo 7 dias seguidos)', () => {
  const races = [{ d: '2026-11-21', name: 'Santander', km: 5 }, { d: '2026-11-29', name: 'Sest Senat', km: 5 }];
  const p = loadTreino('2026-11-12T08:00:00', { rests: { '2026-11-09': true, '2026-11-11': true }, races }).plan('2026-12-06');
  assert.equal(linha(p, '2026-11-16', '2026-11-29'), 'A auto A3 R eve race R R L R A3 R eve race');
  assert.equal(linha(p, '2026-11-30', '2026-12-06'), 'R R L R B auto C');
  let seg = 0;
  Object.keys(p).sort().filter((d) => d > '2026-11-11').forEach((d) => { seg = /^(off|auto|eve)$/.test(p[d]) ? 0 : seg + 1; assert.ok(seg <= 7, d); });
});

test('Próximos dias vai até a última prova dos próximos 30 dias; sem prova perto, 14 dias', () => {
  const duas = [{ d: '2026-11-21', name: 'Santander', km: 5 }, { d: '2026-11-29', name: 'Sest Senat', km: 5 }];
  const h = (races) => loadTreino('2026-11-12T08:00:00', { races }).ev('horizon()');
  assert.equal(h(duas), '2026-11-29');
  assert.equal(h([duas[0]]), '2026-11-21');
  assert.equal(h([{ d: '2026-11-14', name: 'X', km: 5 }]), '2026-11-18');
  assert.equal(h([{ d: '2027-01-20', name: 'Longe', km: 5 }]), '2026-11-25');
  assert.equal(h([]), '2026-11-25');
});

// ---------- modo treino ----------
const semAgenda = (hoje, extra) => loadTreino(hoje, Object.assign({ rests: { '2026-11-09': true, '2026-11-11': true }, races: [{ d: '2026-11-21', name: 'Santander', km: 5 }, { d: '2026-11-29', name: 'Sest Senat', km: 5 }] }, extra || {}));

test('modo treino: os passos de cada treino saem do plano do dia', () => {
  const t = semAgenda('2026-11-12T19:00:00');
  const n = (k) => t.json(`wkItems("${k}").map(function(x){ return x.t === "loop" ? "loop:" + x.until : x.lbl; })`);
  assert.deepEqual(n('L'), ['Trote longo', 'Caminhada', 'loop:dist']);
  assert.deepEqual(n('B'), ['loop:dist']);
  assert.equal(n('R').length, 9);
  assert.equal(n('C').length, 4 + 6 + 5 + 1);
  assert.equal(t.json('wkItems("L")[0]').target, 300);
  // A de 16/11 é ensaio: 5 blocos de 3 min a 7,5
  const u = semAgenda('2026-11-16T19:00:00'), a = u.json('wkItems("A")');
  assert.equal(a.length, 5 + 4 + 1);
  assert.deepEqual([a[0].spd, a[0].target, a[0].log], [7.5, 180, ['A', 0]]);
});

test('modo treino no L: cada toque guarda a duração exata, e a FC do trote longo vai pra anotação do dia', () => {
  const t = semAgenda('2026-11-12T19:00:00');
  t.ev('wkStart("L", "walk")');
  t.passa(283); t.ev('wkNext(false)');            // trote longo: 4min43s
  assert.equal(t.ev('wkEdit'), 0, 'pede a FC do trote longo');
  t.passa(20); t.ev('wkSetHr(0, 158)');
  assert.deepEqual(t.json('logs["2026-11-12"].L[0]'), { hr: 158, dur: 283 });
  assert.equal(t.json('replay("2026-11-12").n.tl').bad, 1, '4min43s fica 2 s abaixo da tolerância (4min45s): incompleto');
  t.passa(100); t.ev('wkNext(false)');            // caminhada até 140 (2 min no total)
  assert.equal(t.ev('wkStepOf().lbl'), 'Trote 1');
  t.passa(60); t.ev('wkNext(false)');
  assert.equal(t.ev('wkStepOf().lbl'), 'Caminhada');
  t.passa(180); t.ev('wkNext(false)');
  assert.equal(t.ev('wkStepOf().lbl'), 'Trote 2');
  t.passa(50); t.ev('wkNext(true)');              // fechou os 5 km no meio do trote 2
  assert.equal(t.ev('WK.done'), true);
  assert.deepEqual(t.json('logs["2026-11-12"].W'), { k: 'L', segs: [['r', 283, 158], ['w', 120, 0], ['r', 60, 0], ['w', 180, 0], ['r', 50, 0]] });
});

test('modo treino: desfazer um toque errado devolve o passo com o cronômetro onde estaria', () => {
  const t = semAgenda('2026-11-12T19:00:00');
  t.ev('wkStart("L", "walk")'); const t0 = t.ev('WK.s');
  t.passa(40); t.ev('wkNext(false)');             // toque sem querer no meio do trote longo
  t.passa(5); t.ev('wkUndo()');
  assert.equal(t.ev('wkStepOf().lbl'), 'Trote longo');
  assert.equal(t.ev('Date.now() - WK.s'), 45000, 'o trote longo segue contando desde o começo dele');
  assert.equal(t.ev('WK.segs.length'), 0);
  assert.equal(t.ev('WK.s'), t0);
});

test('modo treino: ajustar a duração de um trecho move o começo do seguinte, sem mexer no relógio', () => {
  const t = semAgenda('2026-11-12T19:00:00');
  t.ev('wkStart("L", "walk")');
  t.passa(290); t.ev('wkNext(false)');            // tocou 10 s atrasado
  t.ev('wkSetHr(0, 160)');
  t.passa(30);
  assert.equal(t.ev('wkShift(0, -5)'), true); assert.equal(t.ev('wkShift(0, -5)'), true);
  assert.equal(t.ev('wkDur(WK.segs[0])'), 280);
  assert.equal(t.ev('Date.now() - WK.s'), 40000, 'a caminhada ganhou os 10 s');
  assert.deepEqual(t.json('logs["2026-11-12"].L[0]'), { hr: 160, dur: 280 });
  assert.equal(t.ev('wkShift(0, 60)'), false, 'não deixa passar da hora atual');
});

test('modo treino: o andamento sobrevive a recarregar a página; no dia seguinte não volta', () => {
  const t = semAgenda('2026-11-12T19:00:00');
  t.ev('wkStart("B", "walk")');
  const salvo = t.ev('store("tdd-wk")');
  const u = semAgenda('2026-11-12T19:06:00', { extra: { 'tdd-wk': salvo } });
  assert.equal(u.ev('WK && WK.k'), 'B'); assert.equal(u.ev('wkStepOf().lbl'), 'Trote 1'); assert.equal(u.ev('wkOpen'), true);
  const v = semAgenda('2026-11-13T06:00:00', { extra: { 'tdd-wk': salvo } });
  assert.equal(v.ev('WK'), null);
});

test('anotar o treino de ontem: a anotação vai pro dia anterior', () => {
  const t = semAgenda('2026-11-13T07:00:00');
  t.ev('setLogDay(addDays(today, -1))');
  t.ev('saveBlock("L", 0, {hr: 155, dur: 300})');
  assert.deepEqual(t.json('logs["2026-11-12"].L[0]'), { hr: 155, dur: 300 });
  assert.equal(t.json('logs["2026-11-13"] || null'), null);
});

test('dia de prova: o aviso usa o trote e a caminhada dos Ajustes', () => {
  const t = semAgenda('2026-11-12T19:00:00');
  assert.deepEqual(t.json('[DEF.raceRun, DEF.raceWalk]'), [3, 90]);
  assert.equal(t.json('setAt("2026-11-12").raceRun'), 3);
  const u = semAgenda('2026-11-16T19:00:00', { cfg: { sets: [{ d: '2026-11-15', v: { raceRun: 4 } }] } });
  assert.equal(u.json('wkItems("A")[0]').target, 240);
});

test('descartar o treino apaga também a FC e o resumo que ele gravou no dia', () => {
  const t = semAgenda('2026-11-12T09:00:00');
  t.ev('wkStart("L", "walk")'); t.passa(300); t.ev('wkNext(false)'); t.ev('wkSetHr(0, 150)');
  assert.deepEqual(t.json('logs["2026-11-12"].L[0]'), { hr: 150, dur: 300 });
  t.passa(60); t.ev('wkNext(false)'); t.passa(60); t.ev('wkNext(true)');
  assert.ok(t.json('logs["2026-11-12"].W'));
  t.ev('wkDrop()');
  assert.deepEqual(t.json('logs["2026-11-12"]'), { L: {} });
  assert.equal(t.ev('WK'), null);
  assert.equal(t.json('replay("2026-11-12").n.tl || null'), null, 'o teste descartado não conta pra degrau');
});

test('apagar só a FC de um trecho: o trecho e o resto do treino ficam', () => {
  const t = semAgenda('2026-11-16T19:00:00');
  t.ev('wkStart("A", "walk")');
  t.passa(180); t.ev('wkNext(false)'); t.ev('wkSetHr(0, 168)');
  t.passa(90); t.ev('wkNext(false)'); t.passa(180); t.ev('wkNext(false)'); t.ev('wkSetHr(2, 171)');
  t.ev('wkClearHr(0)');
  assert.deepEqual(t.json('logs["2026-11-16"].A'), { 1: { hr: 171, dur: 180 } });
  assert.equal(t.ev('WK.segs.length'), 3); assert.equal(t.ev('WK.segs[0].hr'), 0);
});

test('modo treino: um segundo toque em menos de 5 s é ignorado; depois de 5 s vale', () => {
  const t = semAgenda('2026-11-12T19:00:00');
  t.ev('wkStart("L", "walk")'); t.passa(10); t.ev('wkNext(false)');
  t.passa(2); t.ev('wkNext(false)');
  assert.equal(t.ev('WK.segs.length'), 1, 'o toque duplo não fechou a caminhada');
  assert.equal(t.ev('wkStepOf().lbl'), 'Caminhada');
  t.passa(4); t.ev('wkNext(false)');
  assert.equal(t.ev('WK.segs.length'), 2);
  assert.equal(t.ev('wkDur(WK.segs[1])'), 6);
  // desfazer libera o botão na hora
  t.ev('wkUndo()'); t.passa(1); t.ev('wkNext(false)');
  assert.equal(t.ev('WK.segs.length'), 2);
});

test('L por tempo: trote de 2 min com teto 160, caminhada de 2 min fixos', () => {
  const t = semAgenda('2026-11-24T19:00:00');
  const it = t.json('wkItems("L")');
  assert.deepEqual([it[1].lbl, it[1].target], ['Caminhada', 120]);
  const lp = it[2];
  assert.deepEqual([lp.a.target, lp.a.cond, lp.b.target, lp.b.cond], [120, '2min · teto FC 160', 120, '2min']);
  assert.deepEqual(t.json('[DEF.lTop, DEF.lRun, DEF.lWalk, DEF.longTop]'), [160, 120, 120, 160]);
  assert.equal(lp.b.note, 'Tempo fixo.');
});

test('busca no Strava de novo sozinha ao voltar pra página, no máximo a cada 10 min, e só se a busca automática já era permitida', () => {
  const t = semAgenda('2026-11-12T20:00:00');
  t.ev('globalThis.__n = 0; mcp = {}; sync = function(){ globalThis.__n++; lastSyncAt = Date.now(); }');
  t.ev('autoAgain()'); assert.equal(t.ev('__n'), 0, 'sem a permissão confirmada na abertura, não busca');
  t.ev('autoOk = true; lastSyncAt = Date.now()');
  t.passa(5 * 60); t.ev('autoAgain()'); assert.equal(t.ev('__n'), 0, '5 min depois: ainda não');
  t.passa(6 * 60); t.ev('autoAgain()'); assert.equal(t.ev('__n'), 1, '11 min depois: busca');
  t.ev('autoAgain()'); assert.equal(t.ev('__n'), 1, 'logo em seguida: não repete');
});

test('treino conta com 2 km ou 20 min: R de 34 min com a distância errada no relógio entra; aquecimento solto não', () => {
  const t = semAgenda('2026-11-13T20:00:00');
  assert.equal(t.ev('isWorkout("Run", {distance: 1390, moving_time: 2059})'), true);
  assert.equal(t.ev('isWorkout("Run", {distance: 2100, moving_time: 900})'), true);
  assert.equal(t.ev('isWorkout("Run", {distance: 800, moving_time: 420})'), false);
  assert.equal(t.ev('isWorkout("Walk", {distance: 3000, moving_time: 2400})'), false);
});

test('B por tempo: 3 min de trote com teto 165 e 2 min de caminhada, até 5 km (4 km nos 5 dias antes de prova)', () => {
  const t = semAgenda('2026-11-14T08:00:00');
  const it = t.json('wkItems("B")');
  assert.equal(it.length, 1);
  assert.deepEqual([it[0].a.target, it[0].a.cond, it[0].b.target, it[0].b.cond, it[0].exit], [180, '3min · teto FC 165', 120, '2min', 'Fechei os 5 km']);
  assert.equal(semAgenda('2026-11-16T08:00:00').json('wkItems("B")')[0].exit, 'Fechei os 4 km');
});

test('C: aquecimento são 2 blocos do B; R: o alarme é o mesmo número nas duas orientações', () => {
  const t = semAgenda('2026-12-06T08:00:00');
  const c = t.json('wkItems("C")');
  assert.deepEqual(c.slice(0, 4).map((x) => [x.target, x.kind]), [[180, 'r'], [120, 'w'], [180, 'r'], [120, 'w']]);
  const r = t.json('wkItems("R")');
  assert.match(r[0].note, /^Vibrou \(150\)\? Baixe a base/);
  assert.match(r[1].note, /^Vibrou \(150\)\? Volte pra/);
});

test('como você chegou: A, B e L perguntam; andando começa no trote; de bike aquece 5 min fora do treino', () => {
  const t = semAgenda('2026-11-14T09:30:00');
  t.ev('wkStart("B")');
  assert.equal(t.ev('WK.ask'), true, 'pergunta antes de começar');
  t.ev('wkStart("B", "walk")');
  assert.equal(t.ev('wkStepOf().lbl'), 'Trote 1');
  assert.equal(t.ev('store("tdd-arrive")'), 'walk', 'lembra a resposta');
  const u = semAgenda('2026-11-14T09:30:00');
  u.ev('wkStart("B", "bike")');
  assert.equal(u.ev('wkStepOf().kind'), 'a');
  u.passa(300); u.ev('wkNext(false)');
  assert.equal(u.ev('wkStepOf().kind'), 'p');
  u.passa(40); u.ev('wkNext(false)');                // parou, zerou a esteira e começou
  assert.equal(u.ev('wkStepOf().lbl'), 'Trote 1');
  assert.equal(u.ev('Date.now() - WK.t0'), 0, 'o tempo total do treino começa agora');
  u.passa(180); u.ev('wkNext(false)'); u.passa(120); u.ev('wkNext(true)');
  assert.deepEqual(u.json('logs["2026-11-14"].W'), { k: 'B', segs: [['r', 180, 0], ['w', 120, 0]] }, 'aquecimento e troca ficam fora');
  // R e C não perguntam
  const r = semAgenda('2026-11-13T19:00:00'); r.ev('wkStart("R")'); assert.equal(r.ev('!!WK.ask'), false);
});

test('sem aquecimento no treino: A fecha 3 km só com os blocos e a caminhada final', () => {
  const t = semAgenda('2026-11-16T19:00:00');
  assert.deepEqual(t.json('aShape(5, 7.5, 3, setAt(today))'), { km: 3, min: 29 });
  assert.equal(t.ev('bEst(5)'), 51);
});
