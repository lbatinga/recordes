// Card do ano no Grupo: a linha que diz qual desempate pôs o líder na frente quando o 1º e o 2º
// empatam em meses vencidos (pontos somados → confronto direto → nível por idade e sexo).
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
  const html = app.ev('grupoTab()');
  const txt = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const linha = (/<p class="yr-det">(Empate em[\s\S]*?)<\/p>/.exec(html) || [])[1];
  const lista = (/<ol class="yr-rank">([\s\S]*?)<\/ol>/.exec(html) || ['', ''])[1];
  return {
    linha: linha == null ? null : txt(linha),
    lider: (/<b>([^<]+)<\/b><span class="yr-n">([^<]+)</.exec(html) || []).slice(1, 3).join(': '),
    ordem: [...lista.matchAll(/<span>([^<]+)<\/span><span class="n">/g)].map((m) => m[1]),
  };
}
const NIVEL = { '2026-07': { pts: [2, 10, 8] }, '2026-08': { pts: [2, 8, 10] } }; // Bia e Caio: 1 mês cada, 18 pontos cada, 1 a 1 no confronto

test('sem empate no topo, a linha não aparece', () => {
  const r = ano({ '2026-08': { pts: [9, 7, 5] }, '2026-09': { pts: [9, 10, 4] }, '2026-10': { pts: [9, 3, 4] } });
  assert.equal(r.linha, null);
  assert.equal(r.lider, 'Ana: 2 meses vencidos');
});

test('1º critério, pontos somados: a linha mostra os pontos de quem empatou, na ordem da lista', () => {
  const r = ano({ '2026-08': { pts: [9, 7, 5] }, '2026-09': { pts: [6, 10, 4] } });
  assert.equal(r.linha, 'Empate em 1 mês. Desempate por pontos somados: Bia 17 × Ana 15.');
  assert.deepEqual(r.ordem, ['Bia', 'Ana', 'Caio']);
});

test('2º critério, confronto direto: mês empatado entre os dois não conta, mês em que um ficou à frente conta', () => {
  // julho Ana, agosto Bia, setembro empatado no topo entre Ana e Caio (ninguém vence); pontos 25 a 25
  const r = ano({ '2026-07': { pts: [10, 8, 2] }, '2026-08': { pts: [8, 10, 2] }, '2026-09': { pts: [7, 7, 7], ordem: [1, 3, 2], empate: [1, 3] } });
  assert.equal(r.linha, 'Empate em 1 mês. Desempate por confronto direto (meses à frente): Ana 2 × Bia 1.');
  assert.equal(r.lider, 'Ana: 1 mês vencido');
});

test('3º critério, nível por idade e sexo, com os dois níveis', () => {
  const r = ano(NIVEL, { 2: 44.6, 3: 32.7 });
  assert.equal(r.linha, 'Empate em 1 mês. Desempate por nível por idade e sexo: Bia 44,6% × Caio 32,7%.');
  assert.deepEqual(r.ordem, ['Bia', 'Caio', 'Ana']);
});

test('empate de três resolvido nos pontos: a linha lista os três', () => {
  const r = ano({ '2026-07': { pts: [10, 8, 6] }, '2026-08': { pts: [5, 10, 8] }, '2026-09': { pts: [7, 5, 10] } });
  assert.equal(r.linha, 'Empate em 1 mês. Desempate por pontos somados: Caio 24 × Bia 23 × Ana 22.');
  assert.deepEqual(r.ordem, ['Caio', 'Bia', 'Ana']);
});

test('empate em todos os critérios: a linha diz que o empate continua', () => {
  const r = ano(NIVEL, { 2: 40, 3: 40 });
  assert.equal(r.linha, 'Empate em 1 mês. Empate também nos desempates.');
});

// Os três abaixo falham hoje (achados da revisão de 11/11/2026) e esperam decisão.
test('[Y1] quando só um dos dois tem nível, a linha deveria dizer o que pôs o líder na frente', { todo: 'a lista põe na frente quem tem nível, mas a linha diz "Empate também nos desempates"' }, () => {
  const r = ano(NIVEL, { 3: 44.6 }); // Bia sem 5 km na rua nos últimos 90 dias
  assert.deepEqual(r.ordem.slice(0, 2), ['Caio', 'Bia']);
  assert.doesNotMatch(r.linha, /Empate também nos desempates/);
});

test('[Y2] empate em todos os critérios não deveria dar o troféu do ano a ninguém', { todo: 'o troféu vai pra quem aparece primeiro na lista; no mês, empate total não dá vitória a ninguém' }, () => {
  const r = ano(NIVEL, { 2: 40, 3: 40 });
  assert.equal(r.lider, '');
});

test('[Y3] confronto direto em círculo entre três (A ganha de B, B de C, C de A) não deveria decidir o líder', { todo: 'a linha mostra só Ana 2 × Bia 1, mas Caio ganha de Ana por 2 a 1' }, () => {
  const r = ano({ '2026-07': { pts: [10, 8, 6] }, '2026-08': { pts: [6, 10, 8] }, '2026-09': { pts: [8, 6, 10] } }, { 2: 40, 3: 50 });
  assert.doesNotMatch(r.linha, /confronto direto/);
});
