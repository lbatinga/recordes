// Testes do backend (supabase/functions/api/index.ts) com Supabase e Strava de mentira.
// Rodam a cópia do repositório; o que está publicado no Supabase só muda com deploy.
// O ponto principal: o que o servidor calcula sozinho (webhook, avisos) tem que bater com o app.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, loadServer, act, stravaAct } = require('./harness');

const AID = 7;
// O mesmo treino nos dois formatos: como o app recebe e como o servidor lê do Strava.
function par(o) { return { app: act(o), strava: stravaAct(o) }; }
function historico() {
  const dias = ['2026-08-04', '2026-08-06', '2026-08-11', '2026-08-13', '2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10',
    '2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29'];
  return dias.map((d, i) => par({ id: String(100 + i), start: d, km: 5 }));
}
// O app publica o resumo em "quando"; depois chegam treinos novos sem a pessoa abrir o app.
async function cenario({ publicaEm, agora, novos, pauses, add }) {
  const base = historico();
  const app = loadApp(publicaEm);
  app.setActivities(base.map((x) => x.app), { pauses, add });
  const sm = app.json('buildSummary()');
  const srv = loadServer(agora + '-03:00');
  srv.world.docs[`${AID}|config|summary`] = sm;
  if (pauses) srv.world.docs[`${AID}|config|pauses`] = { weeks: pauses };
  if (add) srv.world.docs[`${AID}|config|overrides`] = { add };
  srv.world.strava[AID] = base.map((x) => x.strava).concat(novos.map((x) => x.strava));
  const live = await srv.refreshLive(AID);
  const juntado = srv.ev('mergeLive')(sm, live).summary;
  // O que o app mostraria se a pessoa abrisse agora, com tudo:
  const app2 = loadApp(agora);
  app2.setActivities(base.map((x) => x.app).concat(novos.map((x) => x.app)), { pauses, add });
  const certo = app2.json('buildSummaryCore()');
  return { sm, live, juntado, certo, srv };
}

test('semana do servidor: domingo a sábado', () => {
  const srv = loadServer('2026-11-09T17:00:00-03:00');
  assert.equal(srv.ev('weekKey("2026-11-08T06:00:00")'), '2026-11-08'); // domingo
  assert.equal(srv.ev('weekKey("2026-11-07T23:59:00")'), '2026-11-01'); // sábado
});

test('ao vivo, mesmo mês: semana, sequência, constância, km, dias e medalhas batem com o app', async () => {
  const novos = [par({ start: '2026-11-03', km: 5 }), par({ start: '2026-11-05', km: 6 })];
  const base = historico();
  // resumo publicado em 02/11 (novembro já começou), treinos de 03 e 05/11 chegam pelo webhook
  const app = loadApp('2026-11-02T08:00:00');
  app.setActivities(base.map((x) => x.app));
  const sm = app.json('buildSummary()');
  const srv = loadServer('2026-11-06T12:00:00-03:00');
  srv.world.docs[`${AID}|config|summary`] = sm;
  srv.world.strava[AID] = base.map((x) => x.strava).concat(novos.map((x) => x.strava));
  const m = srv.ev('mergeLive')(sm, await srv.refreshLive(AID)).summary;
  const app2 = loadApp('2026-11-06T12:00:00');
  app2.setActivities(base.map((x) => x.app).concat(novos.map((x) => x.app)));
  const c = app2.json('buildSummaryCore()');
  const campos = (s) => ({ thisWeek: s.thisWeek, streak: s.streak, bestStreak: s.bestStreak, act12: s.act12, kmMonth: s.kmMonth, daysMonth: s.daysMonth, medals: s.medals });
  assert.deepEqual(campos(m), campos(c));
});

test('ao vivo: aquecimento (menos de 1 km e de 10 min) não conta na semana', async () => {
  const r = await cenario({ publicaEm: '2026-11-02T08:00:00', agora: '2026-11-06T12:00:00', novos: [par({ start: '2026-11-03', km: 0.5, time: 240 })] });
  assert.equal(r.juntado.thisWeek, r.certo.thisWeek);
  assert.equal(r.juntado.thisWeek, 0);
});

test('ao vivo: semana pausada não quebra a sequência', async () => {
  // semana de 01/11 sem corrida e pausada; duas corridas na semana de 08/11
  const r = await cenario({ publicaEm: '2026-10-30T20:00:00', agora: '2026-11-11T12:00:00', pauses: { '2026-11-01': 'viagem' },
    novos: [par({ start: '2026-11-09', km: 5 }), par({ start: '2026-11-10', km: 5 })] });
  assert.equal(r.juntado.streak, r.certo.streak);
  assert.equal(r.juntado.streak, 5);
});

test('ao vivo: corrida lançada à mão pelo dono (overrides.add) conta', async () => {
  const add = [{ id: 'm1', sport_type: 'Run', start_local: '2026-11-04T06:00:00', latlng: null, activity_tags: [], summary: { distance: 5000, moving_time: 2400, elapsed_time: 2400 } }];
  const r = await cenario({ publicaEm: '2026-11-02T08:00:00', agora: '2026-11-06T12:00:00', add, novos: [par({ start: '2026-11-03', km: 5 })] });
  assert.equal(r.juntado.thisWeek, 2);
});

test('ao vivo: treino de esteira entra sem nome (o servidor não lê a descrição); rua entra com o lugar', async () => {
  const r = await cenario({ publicaEm: '2026-11-02T08:00:00', agora: '2026-11-06T12:00:00',
    novos: [par({ start: '2026-11-03T06:00:00', km: 5, latlng: null }), par({ start: '2026-11-04T06:00:00', km: 5 })] });
  assert.ok(r.juntado.runs.includes('2026-11-03T06:00|i'));
  assert.ok(r.juntado.runs.includes('2026-11-04T06:00|-9.66,-35.71'));
});

test('[E17] medalhas atualizam quando a pessoa salva o treino, também depois da virada do mês', async () => {
  // resumo publicado em 30/10; a pessoa corre de 01 a 05/11 (25 km, 5 dias) e não abre o app
  const r = await cenario({ publicaEm: '2026-10-30T20:00:00', agora: '2026-11-05T12:00:00',
    novos: ['01', '02', '03', '04', '05'].map((d) => par({ start: '2026-11-' + d, km: 5 })) });
  assert.ok(r.certo.medals > 0, 'o cenário precisa ter medalha em novembro');
  const app = loadApp('2026-11-05T12:00:00');
  const noPlacar = app.ev(`linesFor("2026-11").filter(function(L){return L.id==="medals"})[0].get(${JSON.stringify(r.juntado)}, "2026-11")`);
  assert.equal(noPlacar, r.certo.medals, `no placar de novembro a pessoa aparece com ${noPlacar} medalha (mês sem dados) até abrir o app; o certo seria ${r.certo.medals}`);
  // as faixas do mês novo são as mesmas que o app calcula (média de ago, set e out, já com outubro fechado)
  assert.deepEqual([r.juntado.nm.kmT, r.juntado.nm.dT], [r.certo.kmT, r.certo.dT]);
  assert.deepEqual([r.juntado.nm.kmMonth, r.juntado.nm.daysMonth], [r.certo.kmMonth, r.certo.daysMonth]);
  assert.equal(r.juntado.month, '2026-10', 'os números de outubro do resumo ficam como estão');
  assert.equal(app.ev(`waitTxt({id:"medals"}, ${JSON.stringify(r.juntado)}, "2026-11")`), '');
});

test('[E17] treino de outubro salvo depois do último resumo entra na média das faixas de novembro', async () => {
  const r = await cenario({ publicaEm: '2026-10-28T20:00:00', agora: '2026-11-05T12:00:00',
    novos: [par({ start: '2026-10-31', km: 12 })].concat(['01', '02', '03'].map((d) => par({ start: '2026-11-' + d, km: 5 }))) });
  assert.deepEqual([r.juntado.nm.kmT, r.juntado.nm.dT, r.juntado.nm.medals], [r.certo.kmT, r.certo.dT, r.certo.medals]);
});

test('[E17] sem dados seguros (resumo de app antigo, ou parado há mais de um mês): "aguardando abrir o app", não 0 medalha', async () => {
  const app = loadApp('2026-11-05T12:00:00');
  const quer = (m) => app.ev(`waitTxt({id:"medals"}, ${JSON.stringify(m)}, "2026-11")`);
  // resumo de versão antiga do app, sem os meses anteriores
  const base = historico();
  const a0 = loadApp('2026-10-30T20:00:00'); a0.setActivities(base.map((x) => x.app));
  const sm = a0.json('buildSummary()'); delete sm.mon;
  const srv = loadServer('2026-11-05T12:00:00-03:00');
  srv.world.docs[`${AID}|config|summary`] = sm;
  srv.world.strava[AID] = base.map((x) => x.strava).concat([par({ start: '2026-11-02', km: 5 }).strava]);
  const m = srv.ev('mergeLive')(sm, await srv.refreshLive(AID)).summary;
  assert.deepEqual({ ...m.nm }, { month: '2026-11', wait: 1 });
  assert.equal(quer(m), 'aguardando abrir o app');
  // resumo de setembro, visto em novembro: dois meses sem abrir
  const r = await cenario({ publicaEm: '2026-09-20T20:00:00', agora: '2026-11-05T12:00:00', novos: [par({ start: '2026-11-02', km: 5 })] });
  assert.equal(quer(r.juntado), 'aguardando abrir o app');
});

test('aviso de quinta a sábado: texto e silêncio', () => {
  const srv = loadServer('2026-11-06T18:00:00-03:00');
  const rt = srv.ev('reminderText');
  assert.equal(rt(5, 2, 3), null, 'com 2 corridas não avisa');
  assert.deepEqual({ ...rt(5, 1, 3) }, { title: 'Sequência de 3 semanas seguidas', body: 'Até sábado falta 1 treino pra manter.' });
  assert.deepEqual({ ...rt(6, 0, 0) }, { title: 'Último dia da semana', body: 'Hoje faltam 2 treinos pra semana contar na constância.' });
});

test('aviso: semana pausada marca "paused" e não quebra a sequência contada', async () => {
  const srv = loadServer('2026-11-12T18:00:00-03:00');
  srv.world.docs[`${AID}|config|pauses`] = { weeks: { '2026-11-01': 'atestado', '2026-11-08': 'atestado' } };
  srv.world.strava[AID] = [stravaAct({ start: '2026-10-27' }), stravaAct({ start: '2026-10-29' }), stravaAct({ start: '2026-10-20' }), stravaAct({ start: '2026-10-22' })];
  assert.deepEqual(await srv.weekStatus(AID), { thisWeek: 0, streak: 2, paused: true });
});

test('[E18] aviso "falta 1 treino" enxerga a corrida lançada à mão (overrides.add), como o app e o placar', async () => {
  const srv = loadServer('2026-11-06T18:00:00-03:00'); // sexta, 18h
  srv.world.strava[AID] = [stravaAct({ start: '2026-11-03' })];
  srv.world.docs[`${AID}|config|overrides`] = { add: [{ id: 'm1', sport_type: 'Run', start_local: '2026-11-05T06:00:00', summary: { distance: 5000, moving_time: 2400 } }] };
  assert.equal((await srv.weekStatus(AID)).thisWeek, 2);
});

test('aviso: a sequência do texto é a mesma do app, mesmo acima de 13 semanas (vem do resumo publicado)', async () => {
  const srv = loadServer('2026-11-06T18:00:00-03:00');
  const A = [], S = [];
  for (let w = 1; w <= 20; w++) {
    const d = new Date(Date.UTC(2026, 10, 3) - w * 7 * 86400000).toISOString().slice(0, 10);
    [d + 'T06:00:00', d + 'T18:00:00'].forEach((t) => { A.push(act({ start: t })); S.push(stravaAct({ start: t })); });
  }
  srv.world.strava[AID] = S;
  const app = loadApp('2026-11-06T18:00:00');
  app.setActivities(A);
  assert.equal((await srv.weekStatus(AID)).streak, 13, 'sem resumo publicado, o servidor só enxerga os 100 dias');
  // resumo publicado duas semanas antes; o servidor completa as semanas seguintes com o que lê do Strava
  const antes = loadApp('2026-10-21T20:00:00');
  antes.setActivities(A.filter((x) => x.start_local < '2026-10-21T20:00:00'));
  srv.world.docs[`${AID}|config|summary`] = antes.json('buildSummary()');
  assert.equal(app.json('streakInfo(state.sessions).current'), 20);
  assert.equal((await srv.weekStatus(AID)).streak, 20);
  // uma semana sem corrida e sem pausa depois do resumo zera a sequência
  srv.world.strava[AID] = S.filter((x) => x.start_date_local.slice(0, 10) < '2026-10-25' || x.start_date_local.slice(0, 10) > '2026-10-31');
  assert.equal((await srv.weekStatus(AID)).streak, 0);
});
