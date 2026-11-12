// Previsão do tempo na aba Provas: vem do Open-Meteo e tem que se renovar enquanto a prova não chega.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

const H = 3600000;
function comRede(app, temp) {
  app.ev(`globalThis.__pedidos = 0; fetch = function(){ globalThis.__pedidos++; return Promise.resolve({ ok: true, json: function(){ return Promise.resolve({ hourly: { time: ['2026-11-21T20:00'], temperature_2m: [${temp}], relative_humidity_2m: [80], apparent_temperature: [${temp}], precipitation_probability: [10] } }); } }); }`);
}
const espera = () => new Promise((r) => setImmediate(r));
const PROVA = '{date:"2026-11-21", time:"20:00"}';

test('previsão guardada há mais de 3 horas é buscada de novo, mostrando a antiga enquanto isso', async () => {
  const app = loadApp('2026-11-12T12:00:00');
  comRede(app, 27);
  app.ev(`wx["h|2026-11-21|20|-9.67,-35.74"] = { t: 31, rh: 70, f: 31, p: 0, at: Date.now() - ${4 * H} }`);
  assert.match(app.ev(`raceForecast(${PROVA}, 9)`), /^31°C/, 'mostra a guardada na hora');
  assert.equal(app.ev('__pedidos'), 1);
  await espera(); await espera();
  assert.match(app.ev(`raceForecast(${PROVA}, 9)`), /^27°C, umidade 80% · atualizada hoje às 12h00$/);
  assert.equal(app.ev('__pedidos'), 1, 'recém-buscada: não pergunta de novo');
});

test('previsão antiga sem data de busca (versões anteriores do app) também é renovada', async () => {
  const app = loadApp('2026-11-12T12:00:00');
  comRede(app, 26);
  app.ev('wx["h|2026-11-21|20|-9.67,-35.74"] = { t: 33, rh: 60, f: 33, p: 0 }');
  assert.match(app.ev(`raceForecast(${PROVA}, 9)`), /^33°C, umidade 60%$/);
  await espera(); await espera();
  assert.match(app.ev(`raceForecast(${PROVA}, 9)`), /^26°C/);
});

test('se a busca nova falhar, a previsão guardada continua na tela', async () => {
  const app = loadApp('2026-11-12T12:00:00');
  app.ev(`wx["h|2026-11-21|20|-9.67,-35.74"] = { t: 31, rh: 70, f: 31, p: 0, at: Date.now() - ${5 * H} }`);
  app.ev(`raceForecast(${PROVA}, 9)`);
  await espera(); await espera();
  assert.match(app.ev(`raceForecast(${PROVA}, 9)`), /^31°C/);
});

test('clima de dia que já passou fica guardado pra sempre', () => {
  const app = loadApp('2026-11-12T12:00:00');
  comRede(app, 20);
  app.ev('wx["h|2026-11-01|6|-9.67,-35.74"] = { t: 25, rh: 85, f: 25, p: null }');
  assert.equal(app.json('wxAt("2026-11-01", 6, null)').t, 25);
  assert.equal(app.ev('__pedidos'), 0);
});

test('a previsão só aparece a partir de 15 dias antes da prova', () => {
  const app = loadApp('2026-11-12T12:00:00');
  assert.equal(app.ev('raceForecast({date:"2026-11-28", time:"06:00"}, 16)'), '');
});
