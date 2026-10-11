# Recordes

PWA pessoal que lê os treinos de corrida do Strava e mostra recordes, metas, provas e medalhas do mês. Cada pessoa entra com a própria conta do Strava e vê só os próprios dados.

## Como funciona

| Parte | Onde |
|---|---|
| App (HTML único + manifest + service worker) | Vercel: `https://recordes-pi.vercel.app` (publica sozinho a cada push na `main`) |
| Backend | Supabase, projeto **Recordes de Corrida** (`npekkekabsoyoagnelsp`), Edge Function `api` |
| Dados | Strava API (app `285788`), só leitura (`read,activity:read_all`) |

- O login é o próprio "Conectar com Strava" (OAuth). A troca do código, a renovação dos tokens e todas as chamadas ao Strava acontecem na Edge Function. O **Client Secret** fica só no Supabase, em *Edge Functions → Secrets* (`STRAVA_CLIENT_SECRET`), e nunca no código do app.
- O app guarda uma sessão aleatória no aparelho. No banco fica só o hash SHA-256 dela.
- Tabelas (`athletes`, `sessions`, `docs`) com RLS ligado e sem políticas: só a função acessa.
- `docs` guarda por atleta: `efforts/<atividade>` (melhores esforços e splits já calculados), `config/metas`, `config/races` (provas, editáveis na tela Provas) e `config/settings` (`range_start`, `walk_until`).

## Rotas da função `api`

`POST /auth` · `GET /me` · `GET /activities` · `GET /streams?id=` · `GET /docs` · `PUT /docs` · `GET /weight` · `GET /partner` · `POST /logout` · `POST /cron/weights`

- **Peso:** lido do perfil do Strava (`profile:read_all`), um ponto por dia em `config/weights`. Uma rotina do pg_cron (`rc-weights`, 9h e 21h de Brasília) chama `/cron/weights` com um token guardado no Vault (`rc_cron_token`); a função só compara o hash dele.
- **Dupla:** cada app publica `config/summary`; `/partner` só devolve o resumo do outro quando os dois `config/partner` apontam um pro outro.

O código da função está em `supabase/functions/api/index.ts` (cópia de referência; o deploy é feito no Supabase).

## Limites do Strava

200 leituras a cada 15 min e 2.000 por dia para o app inteiro, até 10 atletas. O primeiro acesso de alguém novo calcula os esforços treino a treino; se bater no limite, o app pausa e continua sozinho.
