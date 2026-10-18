# Recordes

PWA pessoal que lê os treinos de corrida do Strava e mostra recordes, metas, provas e medalhas do mês. Cada pessoa entra com a própria conta do Strava e vê só os próprios dados.

## Como funciona

| Parte | Onde |
|---|---|
| App (HTML único + manifest + service worker) | Vercel: `https://recordes-pi.vercel.app` (publica sozinho a cada push na `main`) |
| Backend | Supabase, projeto **Recordes de Corrida** (`npekkekabsoyoagnelsp`), Edge Function `api` |
| Dados | Strava API (app `285788`), só leitura (`read,activity:read_all,profile:read_all`) |

- O login é o próprio "Conectar com Strava" (OAuth). A troca do código, a renovação dos tokens e todas as chamadas ao Strava acontecem na Edge Function. O **Client Secret** fica só no Supabase, em *Edge Functions → Secrets* (`STRAVA_CLIENT_SECRET`), e nunca no código do app.
- O app guarda uma sessão aleatória no aparelho. No banco fica só o hash SHA-256 dela.
- Tabelas (`athletes`, `sessions`, `docs`) com RLS ligado e sem políticas: só a função acessa.
- `docs` guarda por atleta: `efforts/<atividade>` (melhores esforços e splits já calculados), `config/metas`, `config/races` (provas, editáveis na tela Provas) e `config/settings` (`range_start`, `walk_until`).

## Rotas da função `api`

`POST /auth` · `GET /me` · `GET /activities` · `GET /streams?id=` · `GET /docs` · `PUT /docs` · `GET /weight` · `GET /partner` · `GET /push/key` · `POST /push/subscribe` · `POST /push/unsubscribe` · `POST /logout` · `POST /cron/weights` · `POST /cron/push`

- **Peso:** lido do perfil do Strava (`profile:read_all`), um ponto por dia em `config/weights`. Só registra quando o valor muda e mantém a primeira pesagem do dia. Uma rotina do pg_cron (`rc-weights`, 9h e 21h de Brasília) chama `/cron/weights` com um token guardado no Vault (`rc_cron_token`); a função só compara o hash dele.
- **Dupla:** cada app publica `config/summary` (v3, com a lista de horários dos treinos dos últimos 120 dias para "treinos juntos"); `/partner` só devolve o resumo do outro quando os dois `config/partner` apontam um pro outro.
- **Avisos (Web Push):** as chaves VAPID são geradas pela própria função e ficam em `docs (0, system, vapid)`. Os aparelhos inscritos ficam em `config/push`. As rotinas `rc-push-semana` (qui e sex, 18h) e `rc-push-sabado` (sáb, 8h) chamam `/cron/push`, que só avisa quem ainda não tem 2 corridas na semana (domingo a sábado).
- **Semana pausada:** `config/pauses` (`{weeks: {"<domingo>": "motivo"}}`). Semana pausada com menos de 2 corridas não conta nem quebra a sequência, no app, na Dupla e no `/cron/push` (que também não avisa nela).
- **Tempo oficial:** campo `chip` (segundos) em cada prova de `config/races`. Vale no lugar do tempo do Strava na distância oficial; se a meta daquela distância tinha a prova como base, ela é recalculada a partir dele.
- **Clima:** Open-Meteo, direto do app e sem chave (previsão até 15 dias, arquivo histórico para datas antigas). Usa o ponto de largada do treino (arredondado a 2 casas) ou Maceió.
- **Retrospectiva:** imagem 1080×1350 gerada no próprio aparelho (canvas), a partir da Coleção ou do aviso no Início nos dias 1 a 7.

O código da função está em `supabase/functions/api/index.ts` (cópia de referência; o deploy é feito no Supabase).

## Limites do Strava

200 leituras a cada 15 min e 2.000 por dia para o app inteiro, até 10 atletas. O primeiro acesso de alguém novo calcula os esforços treino a treino; se bater no limite, o app pausa e continua sozinho.
