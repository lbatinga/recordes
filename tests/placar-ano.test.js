// Card do ano no Grupo (regras de 11/11/2026): meses vencidos, com mês empatado valendo fração →
// pontos somados → confronto direto, só entre 2 → empate, e aí ninguém leva o troféu.
// O nível por idade e sexo não desempata o ano. O resultado de cada mês fechado não muda.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// Monta o Grupo (Ana sou eu, id 1; Bia 2; Caio 3) com meses já fechados e lê o card do ano.
// meses: { '2026-07': { pts: [ana, bia, caio], ordem: [ids], empate: [ids] } }
function ano(meses, niveis) {
  const app = loadApp('2026-11-09T17:00:00');
  const g = (id, nome) => ({ id, firstname: nome, summary: { v: 11, month: '2026-11', ag: (niveis || {})[id] == null ? null : niveis[id], runs: [] } });
  app.setActivities([], { me: { id: 1, firstname: 'Ana' }, group: [g(2, 'Bia'), g(3, 'Caio')] });
  const hist = {}, order = {}, ties = {};
  Object.keys(meses).forEach((m) => {
    const x = meses[m];
    hist[m] = { 1: x.pts[0], 2: x.pts[1], 3: x.pts[2] };
    order[m] = (x.ordem || [1, 2, 3].sort((a, b) => x.pts[b - 1] - x.pts[a - 1])).map(String);
    if (x.empate) ties[m] = x.empate.map(String);
  });
  app.ev(`groupHist=${JSON.stringify(hist)}; groupOrder=${JSON.stringify(order)}; groupTies=${JSON.stringify(ties)}; groupClosed=legacyClosed(groupHist); duoHist={}; GROUP_SINCE={};`);
  const antes = app.ev('JSON.stringify([groupHist, groupOrder, groupTies])');
  const html = app.ev('grupoTab()');
  const txt = (x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const linha = (/<p class="yr-det">(Empate em[\s\S]*?)<\/p>/.exec(html) || [])[1];
  const lista = (/<ol class="yr-rank">([\s\S]*?)<\/ol>/.exec(html) || ['', ''])[1];
  const depois = JSON.parse(app.ev('JSON.stringify([groupHist, groupOrder, groupTies])'));
  delete depois[0]['2026-11']; delete depois[1]['2026-11']; delete depois[2]['2026-11']; // o mês em andamento é recalculado
  return {
    linha: linha == null ? null : txt(linha),
    topo: txt((/<div class="yr-top">([\s\S]*?)<\/div>/.exec(html) || ['', ''])[1]),
    lista: [...lista.matchAll(/<span>([^<]+)<\/span><span class="n">([^<]+)</g)].map((m) => m[1] + ' ' + m[2]),
    empates: [...html.matchAll(/class="yr-c tie"(?: style="background:linear-gradient\(90deg,([^"]*)\)")?[^>]*aria-label="([^"]+)">([^<]*)</g)].map((m) => ({ cores: m[1] ? m[1].split(',').length : 0, rotulo: m[2], texto: m[3] })),
    mesesIntactos: JSON.stringify(depois) === antes,
  };
}

const UM_A_UM = { '2026-07': { pts: [2, 10, 8] }, '2026-08': { pts: [2, 8, 10] } }; // Bia e Caio: 1 mês cada, 18 pontos cada, 1 a 1 no confronto

test('sem empate no topo: troféu pro líder e nenhuma linha de desempate', () => {
  const r = ano({ '2026-08': { pts: [9, 7, 5] }, '2026-09': { pts: [9, 10, 4] }, '2026-10': { pts: [9, 3, 4] } });
  assert.equal(r.linha, null);
  assert.equal(r.topo, '🏆 Ana 2 meses vencidos');
  assert.deepEqual(r.lista, ['Ana 2 meses', 'Bia 1 mês', 'Caio 0 meses']);
});

test('1º desempate, pontos somados: a linha mostra os pontos de quem empatou, na ordem da lista', () => {
  const r = ano({ '2026-08': { pts: [9, 7, 5] }, '2026-09': { pts: [6, 10, 4] } });
  assert.equal(r.linha, 'Empate em 1 mês. Desempate por pontos somados: Bia 17 × Ana 15.');
  assert.equal(r.topo, '🏆 Bia 1 mês vencido');
});

test('2º desempate, confronto direto entre 2: decide o troféu e a linha mostra o placar dos meses', () => {
  // Ana vence jul e ago; Bia vence set e divide jun e out com Caio (0,5 + 0,5): 2 meses cada, 34 pontos cada.
  const r = ano({
    '2026-06': { pts: [2, 8, 8], ordem: [3, 2, 1], empate: [3, 2] }, '2026-07': { pts: [12, 4, 4], ordem: [1, 2, 3] }, '2026-08': { pts: [12, 4, 4], ordem: [1, 2, 3] },
    '2026-09': { pts: [6, 10, 2] }, '2026-10': { pts: [2, 8, 8], ordem: [2, 3, 1], empate: [2, 3] } });
  assert.deepEqual(r.lista, ['Bia 2 meses', 'Ana 2 meses', 'Caio 1 mês']);
  assert.equal(r.linha, 'Empate em 2 meses. Desempate por confronto direto (meses à frente): Bia 3 × Ana 2.');
  assert.equal(r.topo, '🏆 Bia 2 meses vencidos');
});

test('empate em meses, pontos e confronto direto: "Empate no ano", sem troféu, e o nível por idade e sexo não decide', () => {
  for (const niveis of [{ 2: 44.6, 3: 32.7 }, { 2: 32.7, 3: 44.6 }, { 3: 44.6 }, {}]) {
    const r = ano(UM_A_UM, niveis);
    assert.equal(r.topo, 'Empate no ano Bia e Caio');
    assert.equal(r.linha, 'Empate em 1 mês. Empate também nos pontos somados e no confronto direto.');
    assert.deepEqual(r.lista, ['Bia 1 mês', 'Caio 1 mês', 'Ana 0 meses'], 'a ordem não muda com o nível');
  }
});

test('empate de três resolvido nos pontos: a linha lista os três', () => {
  const r = ano({ '2026-07': { pts: [10, 8, 6] }, '2026-08': { pts: [5, 10, 8] }, '2026-09': { pts: [7, 5, 10] } });
  assert.equal(r.linha, 'Empate em 1 mês. Desempate por pontos somados: Caio 24 × Bia 23 × Ana 22.');
  assert.equal(r.topo, '🏆 Caio 1 mês vencido');
});

test('três empatados em meses e pontos: o confronto direto não vale (daria círculo) e ninguém leva o troféu', () => {
  const r = ano({ '2026-07': { pts: [10, 8, 6] }, '2026-08': { pts: [6, 10, 8] }, '2026-09': { pts: [8, 6, 10] } }, { 2: 40, 3: 50 });
  assert.equal(r.topo, 'Empate no ano Ana, Bia e Caio');
  assert.equal(r.linha, 'Empate em 1 mês. Empate também nos pontos somados. Com mais de dois empatados, o confronto direto não vale.');
});

test('mês empatado entre 2 vale 0,5 pra cada; a contagem mostra uma casa só quando não é inteira; o quadradinho divide as cores', () => {
  const r = ano({ '2026-07': { pts: [10, 6, 2] }, '2026-08': { pts: [9, 9, 2], ordem: [1, 2, 3], empate: [1, 2] } });
  assert.equal(r.topo, '🏆 Ana 1,5 meses vencidos');
  assert.deepEqual(r.lista, ['Ana 1,5 meses', 'Bia 0,5 meses', 'Caio 0 meses']);
  assert.deepEqual(r.empates, [{ cores: 2, rotulo: 'agosto: empate entre Ana e Bia', texto: '' }]);
  assert.equal(r.linha, null);
});

test('duas metades somam um mês inteiro, e a fração entra na ordem do ano', () => {
  const r = ano({ '2026-07': { pts: [10, 6, 2] }, '2026-08': { pts: [2, 9, 9], ordem: [2, 3, 1], empate: [2, 3] }, '2026-09': { pts: [2, 9, 9], ordem: [3, 2, 1], empate: [2, 3] } });
  assert.deepEqual(r.lista, ['Bia 1 mês', 'Caio 1 mês', 'Ana 1 mês']); // 1 mês cada; pontos: Bia 24, Caio 20, Ana 14
  assert.equal(r.linha, 'Empate em 1 mês. Desempate por pontos somados: Bia 24 × Caio 20 × Ana 14.');
});

test('mês em que todos empataram não dá fração a ninguém', () => {
  const r = ano({ '2026-07': { pts: [10, 6, 2] }, '2026-08': { pts: [5, 5, 5], ordem: [1, 2, 3], empate: [1, 2, 3] } });
  assert.deepEqual(r.lista, ['Ana 1 mês', 'Bia 0 meses', 'Caio 0 meses']);
  assert.deepEqual(r.empates, [{ cores: 3, rotulo: 'agosto: empate entre Ana, Bia e Caio', texto: '' }]);
});

test('os meses fechados não mudam: pontos, ordem e empates guardados ficam iguais depois de abrir o Grupo', () => {
  const r = ano({ '2026-07': { pts: [10, 6, 2] }, '2026-08': { pts: [9, 9, 2], ordem: [1, 2, 3], empate: [1, 2] }, '2026-09': { pts: [2, 8, 10] } });
  assert.equal(r.mesesIntactos, true);
});

test('a ajuda descreve a ordem nova do ano', () => {
  const app = loadApp('2026-11-09T17:00:00');
  const h = app.ev('JSON.stringify(helpTopics())');
  assert.match(h, /Confronto direto, só quando o empate é entre 2 pessoas/);
  assert.match(h, /Mês empatado vale fração no ano/);
  assert.doesNotMatch(h, /'Confronto direto', 'Nível por idade e sexo'/);
});
