# Backup do banco (primário → reserva)

`backup.mjs` copia o banco do **Folha Caixa** (projeto primário, o que os apps usam)
para um **projeto Supabase reserva** em outra conta. O primário é **só lido**
(o script bloqueia qualquer coisa que não seja `SELECT` nele). Os apps continuam
apontando para o primário; o reserva é só cópia.

## O que é copiado
- Schema: `folha-caixa/supabase/sql/*.sql` (01…10, depois 99_grants) e por último
  `supabase/2026-11-12_pedidos_v1.sql` (o 99_grants do caixa revoga funções que não conhece,
  por isso os pedidos vêm depois).
- Dados: todas as tabelas de `public` (menos `op_sessions`, que são sessões temporárias),
  em ordem de chave estrangeira, e os logins (`auth.users` / `auth.identities`) para que
  os mesmos usuários e senhas funcionem no reserva. As sequências são acertadas no final.
- **Cada execução de `data` apaga os dados do reserva e copia tudo de novo.**

## Como rodar
```bash
# tokens sbp_ (Supabase › Account › Access Tokens) — nunca commitar
export PRIMARY_REF=cprtigvovwbmigxbosac PRIMARY_TOKEN=sbp_...   # conta do primário
export BACKUP_REF=<ref do reserva>      BACKUP_TOKEN=sbp_...    # conta do reserva
node backup/backup.mjs schema   # 1ª vez (ou quando o schema mudar)
node backup/backup.mjs data     # copia os dados
node backup/backup.mjs verify   # compara contagem de linhas
node backup/backup.mjs all      # tudo junto
```
Alternativa sem token: `PRIMARY_DB_URL` / `BACKUP_DB_URL` (string de conexão Postgres do
painel, precisa de `npm i pg`). Variáveis extras: `SKIP_TABLES`, `CHUNK_ROWS` (1000),
`COPY_AUTH=0` (não copia logins), `FOLHA_CAIXA_DIR` (padrão `../folha-caixa`).

Saída `verify`: código 0 = contagens iguais; 2 = diferença (normal se houve venda durante a cópia — rode de novo).
