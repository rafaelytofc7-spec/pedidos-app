# 🍃 Pedidos · Hortifruti Frutos da Roça

App de **pedidos e encomendas** do Hortifruti Frutos da Roça, **ligado ao banco do Folha Caixa** (mesmo Supabase, mesmo login, mesmos produtos e preços).

**Abrir:** https://rafaelytofc7-spec.github.io/pedidos-app/ · instala como app (PWA) no Android e no PC.
**Loja:** Rua do Santana, 83 — Paracatuzinho, Paracatu/MG · WhatsApp (38) 9.9825-1455

## O que faz
- **Login** com o mesmo usuário e senha do Folha Caixa (só a equipe da loja entra).
- **Pedido (agora)** ou **Encomenda (agendar)** com data e hora combinadas; agenda por dia, atrasadas em vermelho.
- **Catálogo do caixa**: produtos, fotos, preço do dia e promoção vigente. O total é recalculado no banco.
- **Cliente pelo telefone**: busca pelo número. Se não existir, abre o cadastro. **Endereço completo obrigatório** (rua, número, bairro, cidade, UF), com complemento e ponto de referência opcionais. **Localização GPS opcional**, com link do Google Maps.
- **Entrega** (com taxa) ou **retirada na loja**, que mostra o endereço da loja.
- **Pagamento**: Pix, dinheiro, crédito, débito, vale ou fiado. O fiado só aparece para cliente ligado à caderneta do caixa. **Dinheiro pergunta se precisa de troco e para quanto**, recusa um valor menor que o total e mostra quanto levar de troco. Também dá para marcar "já está pago".
- **Andamento**: novo → confirmado → separando → saiu para entrega / pronto para retirada → entregue, ou cancelado (operador precisa do PIN do gerente). Tudo fica no histórico e na auditoria.
- **WhatsApp pronto**: confirmação, saiu para entrega ou pronto para retirada, agradecimento e resumo para a loja ou entregador. As mensagens levam itens, total, pagamento e troco, endereço e localização, com o nome, endereço e WhatsApp da loja. Em Loja há um **link pronto para o cliente pedir** pelo WhatsApp da loja.
- **Entregue + registrar venda no caixa**: vira uma venda de verdade no Folha Caixa pelas funções do próprio caixa (`order_save` + `order_conclude`). Ela ganha número de venda, baixa o estoque, entra no caixa aberto escolhido com o troco e vai para o fiado quando for o caso. Também aparece em *Encomendas* do caixa como concluída. Não deixa registrar duas vezes.

## Banco (Supabase do Folha Caixa)
A migração `supabase/2026-11-12_pedidos_v1.sql` é **só aditiva**. Ela cria `pd_config`, `pd_clientes`, `pd_pedidos`, `pd_pedido_itens`, `pd_pedido_eventos`, a view `v_pd_pedidos` e as funções `pd_*`. Não altera nem apaga nada que já existe.
O RLS segue o mesmo padrão do caixa: só uma conta da loja lê, ninguém grava direto e tudo passa pelas funções `SECURITY DEFINER`.

Aplicar (no computador do dono, com o token da Management API do Supabase):
```bash
SUPABASE_ACCESS_TOKEN=... node ../folha-caixa/supabase/apply.mjs supabase/2026-11-12_pedidos_v1.sql
```
Ou cole o arquivo no **SQL Editor** do painel do Supabase e clique em *Run*.

⚠️ Se um dia rodar `npm run db:apply` do Folha Caixa inteiro, o `99_grants.sql` dele tira a permissão das funções `pd_*`. Depois disso, rode esta migração de novo (ela é idempotente).

## Testes
`tests/` traz os testes de API (26) e de tela (34, Chrome headless no celular 390 px e no PC 1366 px). Eles rodam contra um Supabase **local** (Postgres + GoTrue + PostgREST) com o esquema do Folha Caixa. As capturas ficam em `shots/` (dados de exemplo).

Fotos dos produtos: as mesmas do Folha Caixa, de bancos livres, com os créditos em `CREDITOS-IMAGENS.md`.

## Ativar o banco pelo celular
Abra **https://rafaelytofc7-spec.github.io/pedidos-app/setup.html**: copie o código, abra o SQL Editor do
Supabase, cole e rode, e use **Testar conexão** para confirmar (“Banco pronto”).
