-- Pedidos & Encomendas v1 — migração ADITIVA no banco do Folha Caixa (Supabase cprtigvovwbmigxbosac).
-- Só CRIA coisas novas com prefixo pd_ (tabelas, view, funções). Não apaga nem altera nenhuma tabela/dado existente.
-- Reaproveita: login (users/auth), produtos/preços (products + promoções), e para virar venda usa as funções
-- já existentes do caixa: order_save + order_conclude (mesmo caminho da tela Encomendas: número de venda, estoque, caixa, fiado).
-- Idempotente: pode rodar de novo.
begin;

-- ---------- tabelas ----------
create table if not exists pd_config (
  id int primary key default 1 check (id = 1),
  loja_nome text not null default 'Hortifruti Frutos da Roça',
  loja_whatsapp text not null default '38998251455',      -- só dígitos, com DDD, sem 55
  loja_endereco text not null default 'Rua do Santana, 83 — Paracatuzinho, Paracatu/MG',
  taxa_entrega_cents int not null default 0 check (taxa_entrega_cents >= 0),
  chave_pix text not null default '',
  horario text not null default '',
  updated_at timestamptz not null default now(),
  updated_by int references users(id)
);
alter table pd_config add column if not exists loja_endereco text not null default 'Rua do Santana, 83 — Paracatuzinho, Paracatu/MG';
insert into pd_config(id) values (1) on conflict (id) do nothing;

create table if not exists pd_clientes (
  id serial primary key,
  phone text not null unique,                              -- só dígitos, DDD + número (10 ou 11)
  name text not null check (length(trim(name)) > 0),
  rua text not null check (length(trim(rua)) > 0),
  numero text not null check (length(trim(numero)) > 0),
  bairro text not null check (length(trim(bairro)) > 0),
  cidade text not null check (length(trim(cidade)) > 0),
  uf text not null default 'MG' check (uf ~ '^[A-Z]{2}$'),
  cep text not null default '',
  complemento text not null default '',
  referencia text not null default '',
  lat double precision, lng double precision, loc_precisao int, loc_at timestamptz,
  customer_id int references customers(id),               -- opcional: cliente do fiado no caixa
  note text not null default '',
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pd_pedidos (
  id serial primary key,
  tipo text not null default 'pedido' check (tipo in ('pedido','encomenda')),
  cliente_id int not null references pd_clientes(id),
  cliente_nome text not null, phone text not null,
  modo text not null default 'entrega' check (modo in ('entrega','retirada')),
  -- endereço copiado do cadastro na hora do pedido (o histórico não muda se o cadastro mudar)
  rua text not null default '', numero text not null default '', bairro text not null default '', cidade text not null default '',
  uf text not null default '', cep text not null default '', complemento text not null default '', referencia text not null default '',
  lat double precision, lng double precision,
  agendado_para timestamptz,                               -- encomenda: data/hora combinada (obrigatória)
  status text not null default 'novo' check (status in ('novo','confirmado','separando','saiu_entrega','pronto_retirada','entregue','cancelado')),
  pagamento text not null check (pagamento in ('pix','dinheiro','debito','credito','voucher','fiado')),
  troco_para_cents int check (troco_para_cents is null or troco_para_cents > 0),
  pago boolean not null default false,                     -- já pago antes (ex.: Pix adiantado)
  subtotal_cents int not null default 0, taxa_entrega_cents int not null default 0, total_cents int not null default 0,
  obs text not null default '',
  cancel_motivo text,
  order_id int references orders(id),                      -- encomenda gerada no caixa ao registrar a venda
  sale_id int references sales(id),                        -- venda do caixa
  created_by int references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pd_pedidos_status on pd_pedidos(status, created_at);
create index if not exists idx_pd_pedidos_cliente on pd_pedidos(cliente_id);
create index if not exists idx_pd_pedidos_agenda on pd_pedidos(agendado_para) where agendado_para is not null;

create table if not exists pd_pedido_itens (
  id serial primary key,
  pedido_id int not null references pd_pedidos(id) on delete cascade,
  product_id int references products(id),                  -- null = item avulso
  name text not null, unit text not null default 'UN',
  qty int not null check (qty > 0),                        -- milésimos (1000 = 1 un / 1 kg), igual ao caixa
  unit_price_cents int not null check (unit_price_cents >= 0),
  line_cents int not null check (line_cents >= 0),
  obs text not null default '',
  pos int not null default 0
);
create index if not exists idx_pd_itens_pedido on pd_pedido_itens(pedido_id);

create table if not exists pd_pedido_eventos (
  id serial primary key,
  pedido_id int not null references pd_pedidos(id) on delete cascade,
  status text not null, nota text not null default '',
  user_id int references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_pd_eventos_pedido on pd_pedido_eventos(pedido_id);

-- ---------- RLS (igual às tabelas do caixa: só conta da loja lê; ninguém grava direto, só pelas funções) ----------
do $$
declare t text;
begin
  foreach t in array array['pd_config','pd_clientes','pd_pedidos','pd_pedido_itens','pd_pedido_eventos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('drop policy if exists leitura_loja on %I', t);
    execute format('create policy leitura_loja on %I for select to authenticated using (is_store_account())', t);
  end loop;
end $$;

-- ---------- view ----------
create or replace view v_pd_pedidos with (security_invoker = true) as
  select p.*, _local_date(p.created_at) as local_date,
         u.name as created_by_name, s.number as sale_number,
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'product_id', i.product_id, 'name', i.name, 'unit', i.unit, 'qty', i.qty,
                   'unit_price_cents', i.unit_price_cents, 'line_cents', i.line_cents, 'obs', i.obs, 'icon', pr.icon) order by i.pos, i.id)
                   from pd_pedido_itens i left join products pr on pr.id = i.product_id where i.pedido_id = p.id), '[]'::jsonb) as itens,
         coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'nota', e.nota, 'at', e.created_at, 'por', eu.name) order by e.id)
                   from pd_pedido_eventos e left join users eu on eu.id = e.user_id where e.pedido_id = p.id), '[]'::jsonb) as eventos
    from pd_pedidos p left join users u on u.id = p.created_by left join sales s on s.id = p.sale_id;
revoke all on v_pd_pedidos from anon;
grant select on v_pd_pedidos to authenticated;

-- ---------- helpers ----------
create or replace function _pd_txt(j jsonb, k text) returns text language sql immutable as $$ select trim(coalesce(j->>k, '')) $$;

create or replace function _pd_json(p_id int) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) from v_pd_pedidos v where v.id = p_id
$$;

-- preço de venda de agora (promoção vigente vale, igual ao caixa)
create or replace function _pd_preco(p_product int) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select x.promo_price_cents from promotions x where x.product_id = p_product and x.starts_at <= now()
                     and least(x.ends_at, coalesce(x.ended_at, x.ends_at)) > now() order by x.starts_at desc limit 1),
                  (select price_cents from products where id = p_product))
$$;

-- ---------- config ----------
create or replace function pd_config_salvar(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_wa text; v_taxa int;
begin
  u := _op(p_token);
  perform _require_role(u, array['admin','gerente']);
  v_wa := _br_phone(p_data->>'loja_whatsapp');
  if v_wa = '' then perform _err('Informe o WhatsApp da loja (DDD + número).', 'TELEFONE'); end if;
  v_taxa := coalesce(nullif(p_data->>'taxa_entrega_cents', '')::int, 0);
  if v_taxa < 0 then perform _err('Taxa de entrega inválida.'); end if;
  update pd_config set loja_nome = coalesce(nullif(_pd_txt(p_data, 'loja_nome'), ''), loja_nome), loja_whatsapp = v_wa,
    taxa_entrega_cents = v_taxa, chave_pix = _pd_txt(p_data, 'chave_pix'),
    loja_endereco = coalesce(nullif(_pd_txt(p_data, 'loja_endereco'), ''), loja_endereco), horario = _pd_txt(p_data, 'horario'),
    updated_at = now(), updated_by = u.id where id = 1;
  perform _audit(u.id, 'PEDIDOS_CONFIG', 'pd_config', 1, p_data);
  return (select to_jsonb(c) from pd_config c where id = 1);
end $$;

-- ---------- clientes (cadastro pelo telefone; endereço completo obrigatório) ----------
create or replace function pd_cliente_salvar(p_token text, p_id int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; v_phone text; v_id int; v_falta text[] := '{}'; v_uf text; v_lat double precision; v_lng double precision; v_cust int;
begin
  u := _op(p_token);
  v_phone := _br_phone(p_data->>'phone');
  if v_phone = '' then perform _err('Informe o telefone (WhatsApp) com DDD.', 'TELEFONE'); end if;
  if _pd_txt(p_data, 'name') = '' then v_falta := v_falta || 'nome'::text; end if;
  if _pd_txt(p_data, 'rua') = '' then v_falta := v_falta || 'rua'::text; end if;
  if _pd_txt(p_data, 'numero') = '' then v_falta := v_falta || 'número (use S/N se não tiver)'::text; end if;
  if _pd_txt(p_data, 'bairro') = '' then v_falta := v_falta || 'bairro'::text; end if;
  if _pd_txt(p_data, 'cidade') = '' then v_falta := v_falta || 'cidade'::text; end if;
  if array_length(v_falta, 1) > 0 then perform _err('Endereço incompleto: falta ' || array_to_string(v_falta, ', ') || '.', 'ENDERECO'); end if;
  if length(_pd_txt(p_data, 'rua')) < 3 then perform _err('Endereço incompleto: escreva o nome da rua.', 'ENDERECO'); end if;
  if length(_pd_txt(p_data, 'bairro')) < 2 or length(_pd_txt(p_data, 'cidade')) < 2 then perform _err('Endereço incompleto: bairro e cidade.', 'ENDERECO'); end if;
  v_uf := upper(coalesce(nullif(_pd_txt(p_data, 'uf'), ''), 'MG'));
  if v_uf !~ '^[A-Z]{2}$' then perform _err('UF inválida (ex.: MG).', 'ENDERECO'); end if;
  if _pd_txt(p_data, 'cep') <> '' and regexp_replace(_pd_txt(p_data, 'cep'), '\D', '', 'g') !~ '^\d{8}$' then perform _err('CEP inválido (8 números).', 'ENDERECO'); end if;
  v_lat := nullif(p_data->>'lat', '')::double precision; v_lng := nullif(p_data->>'lng', '')::double precision;
  if (v_lat is null) <> (v_lng is null) or (v_lat is not null and (abs(v_lat) > 90 or abs(v_lng) > 180)) then perform _err('Localização inválida.'); end if;
  v_cust := nullif(p_data->>'customer_id', '')::int;
  if v_cust is not null and not exists (select 1 from customers where id = v_cust) then perform _err('Cliente do fiado não encontrado.', 'NAO_ENCONTRADO'); end if;
  if exists (select 1 from pd_clientes where phone = v_phone and id is distinct from p_id) then
    perform _err('Já existe cliente com esse telefone. Busque pelo telefone para editar.', 'CONFLITO');
  end if;
  if p_id is null then
    insert into pd_clientes(phone, name, rua, numero, bairro, cidade, uf, cep, complemento, referencia, lat, lng, loc_precisao, loc_at, customer_id, note, created_by)
    values (v_phone, _pd_txt(p_data, 'name'), _pd_txt(p_data, 'rua'), _pd_txt(p_data, 'numero'), _pd_txt(p_data, 'bairro'), _pd_txt(p_data, 'cidade'), v_uf,
      regexp_replace(_pd_txt(p_data, 'cep'), '\D', '', 'g'), _pd_txt(p_data, 'complemento'), _pd_txt(p_data, 'referencia'), v_lat, v_lng,
      nullif(p_data->>'loc_precisao', '')::int, case when v_lat is not null then now() end, v_cust, _pd_txt(p_data, 'note'), u.id)
    returning id into v_id;
  else
    update pd_clientes set phone = v_phone, name = _pd_txt(p_data, 'name'), rua = _pd_txt(p_data, 'rua'), numero = _pd_txt(p_data, 'numero'),
      bairro = _pd_txt(p_data, 'bairro'), cidade = _pd_txt(p_data, 'cidade'), uf = v_uf, cep = regexp_replace(_pd_txt(p_data, 'cep'), '\D', '', 'g'),
      complemento = _pd_txt(p_data, 'complemento'), referencia = _pd_txt(p_data, 'referencia'), lat = v_lat, lng = v_lng,
      loc_precisao = nullif(p_data->>'loc_precisao', '')::int,
      loc_at = case when v_lat is null then null when lat is distinct from v_lat or lng is distinct from v_lng then now() else loc_at end,
      customer_id = v_cust, note = _pd_txt(p_data, 'note'), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then perform _err('Cliente não encontrado.', 'NAO_ENCONTRADO'); end if;
  end if;
  perform _audit(u.id, case when p_id is null then 'PEDIDOS_CLIENTE_CRIADO' else 'PEDIDOS_CLIENTE_ALTERADO' end, 'pd_cliente', v_id,
    jsonb_build_object('nome', _pd_txt(p_data, 'name'), 'telefone', v_phone));
  return (select to_jsonb(c) from pd_clientes c where id = v_id);
end $$;

-- ---------- pedido / encomenda ----------
-- p_data: {tipo, cliente_id, modo, agendado_para, pagamento, troco_para_cents, pago, cobrar_taxa(bool), taxa_entrega_cents, obs,
--          itens:[{product_id|null, name, unit, qty, unit_price_cents (só avulso), obs}]}
create or replace function pd_pedido_salvar(p_token text, p_id int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; c pd_clientes; o pd_pedidos; it jsonb; p products; v_id int; v_pos int := 0; v_qty int; v_price int; v_line int;
  v_sub int := 0; v_taxa int := 0; v_total int; v_tipo text := coalesce(nullif(p_data->>'tipo', ''), 'pedido');
  v_modo text := coalesce(nullif(p_data->>'modo', ''), 'entrega'); v_pag text := nullif(p_data->>'pagamento', '');
  v_troco int := nullif(p_data->>'troco_para_cents', '')::int; v_pago boolean := coalesce((p_data->>'pago')::boolean, false);
  v_ag timestamptz := nullif(p_data->>'agendado_para', '')::timestamptz; v_itens jsonb := coalesce(p_data->'itens', '[]'::jsonb);
  v_name text; v_unit text;
begin
  u := _op(p_token);
  if v_tipo not in ('pedido','encomenda') then perform _err('Tipo inválido.'); end if;
  if v_modo not in ('entrega','retirada') then perform _err('Escolha entrega ou retirada.'); end if;
  select * into c from pd_clientes where id = nullif(p_data->>'cliente_id', '')::int;
  if c.id is null then perform _err('Escolha o cliente (busque pelo telefone).', 'CLIENTE'); end if;
  if v_modo = 'entrega' and (trim(c.rua) = '' or trim(c.numero) = '' or trim(c.bairro) = '' or trim(c.cidade) = '') then
    perform _err('Endereço do cliente incompleto: complete o cadastro antes de pedir entrega.', 'ENDERECO');
  end if;
  if v_tipo = 'encomenda' and v_ag is null then perform _err('Encomenda: informe a data e a hora combinadas.', 'AGENDA'); end if;
  if v_ag is not null and p_id is null and v_ag < now() - interval '1 hour' then perform _err('A data combinada já passou.', 'AGENDA'); end if;
  if v_pag is null or v_pag not in ('pix','dinheiro','debito','credito','voucher','fiado') then perform _err('Escolha como o cliente vai pagar.', 'PAGAMENTO'); end if;
  if v_pag = 'fiado' and c.customer_id is null then perform _err('Fiado: ligue o cadastro a um cliente do fiado do caixa (editar cliente).', 'PAGAMENTO'); end if;
  if v_pag <> 'dinheiro' then v_troco := null; end if;
  if v_pag = 'fiado' then v_pago := false; end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then perform _err('Coloque pelo menos um item.'); end if;
  if p_id is not null then
    select * into o from pd_pedidos where id = p_id for update;
    if o.id is null then perform _err('Pedido não encontrado.', 'NAO_ENCONTRADO'); end if;
    if o.status in ('entregue','cancelado') or o.sale_id is not null then perform _err('Pedido ' || o.status || ': não dá para alterar.', 'CONFLITO'); end if;
    delete from pd_pedido_itens where pedido_id = p_id;
    v_id := p_id;
  else
    insert into pd_pedidos(tipo, cliente_id, cliente_nome, phone, pagamento, created_by) values (v_tipo, c.id, c.name, c.phone, v_pag, u.id)
    returning id into v_id;
  end if;
  for it in select * from jsonb_array_elements(v_itens) loop
    v_pos := v_pos + 1; p := null;
    v_qty := nullif(it->>'qty', '')::int;
    if v_qty is null or v_qty <= 0 then perform _err('Quantidade inválida em ' || coalesce(nullif(it->>'name', ''), 'um item') || '.'); end if;
    if nullif(it->>'product_id', '') is not null then
      select * into p from products where id = (it->>'product_id')::int and deleted_at is null and active;
      if p.id is null then perform _err('Produto ' || coalesce(it->>'name', '') || ' não está mais à venda.', 'NAO_ENCONTRADO'); end if;
      if p.unit <> 'KG' and v_qty % 1000 <> 0 then perform _err(p.name || ' é vendido por unidade inteira.'); end if;
      v_price := _pd_preco(p.id); v_name := p.name; v_unit := p.unit;
    else
      v_name := _pd_txt(it, 'name'); v_unit := case when it->>'unit' = 'KG' then 'KG' else 'UN' end;
      if v_name = '' then perform _err('Item avulso sem nome.'); end if;
      if v_unit <> 'KG' and v_qty % 1000 <> 0 then perform _err(v_name || ': quantidade por unidade inteira.'); end if;
      v_price := nullif(it->>'unit_price_cents', '')::int;
      if v_price is null or v_price < 0 then perform _err('Informe o preço de ' || v_name || '.'); end if;
    end if;
    v_line := round(v_price::numeric * v_qty / 1000.0)::int;
    v_sub := v_sub + v_line;
    insert into pd_pedido_itens(pedido_id, product_id, name, unit, qty, unit_price_cents, line_cents, obs, pos)
    values (v_id, p.id, v_name, v_unit, v_qty, v_price, v_line, _pd_txt(it, 'obs'), v_pos);
  end loop;
  if v_modo = 'entrega' and coalesce((p_data->>'cobrar_taxa')::boolean, true) then
    v_taxa := coalesce(nullif(p_data->>'taxa_entrega_cents', '')::int, (select taxa_entrega_cents from pd_config where id = 1), 0);
    if v_taxa < 0 then perform _err('Taxa de entrega inválida.'); end if;
  end if;
  v_total := v_sub + v_taxa;
  if v_total <= 0 then perform _err('O total precisa ser maior que zero.'); end if;
  if v_troco is not null and v_troco < v_total then
    perform _err('Troco para ' || _brl(v_troco) || ' é menor que o total (' || _brl(v_total) || ').', 'TROCO');
  end if;
  update pd_pedidos set tipo = v_tipo, cliente_id = c.id, cliente_nome = c.name, phone = c.phone, modo = v_modo,
    rua = case when v_modo = 'entrega' then c.rua else '' end, numero = case when v_modo = 'entrega' then c.numero else '' end,
    bairro = case when v_modo = 'entrega' then c.bairro else '' end, cidade = case when v_modo = 'entrega' then c.cidade else '' end,
    uf = case when v_modo = 'entrega' then c.uf else '' end, cep = case when v_modo = 'entrega' then c.cep else '' end,
    complemento = case when v_modo = 'entrega' then c.complemento else '' end, referencia = case when v_modo = 'entrega' then c.referencia else '' end,
    lat = case when v_modo = 'entrega' then c.lat end, lng = case when v_modo = 'entrega' then c.lng end,
    agendado_para = v_ag, pagamento = v_pag, troco_para_cents = v_troco, pago = v_pago,
    subtotal_cents = v_sub, taxa_entrega_cents = v_taxa, total_cents = v_total, obs = _pd_txt(p_data, 'obs'), updated_at = now()
   where id = v_id;
  insert into pd_pedido_eventos(pedido_id, status, nota, user_id)
  values (v_id, case when p_id is null then 'novo' else o.status end, case when p_id is null then 'Criado' else 'Alterado' end, u.id);
  perform _audit(u.id, case when p_id is null then 'PEDIDO_CRIADO' else 'PEDIDO_ALTERADO' end, 'pd_pedido', v_id,
    jsonb_build_object('tipo', v_tipo, 'cliente', c.name, 'total', v_total, 'pagamento', v_pag));
  return _pd_json(v_id);
end $$;

-- mudar o andamento. Cancelar: gerente/admin (operador precisa do PIN do gerente, como no caixa)
create or replace function pd_pedido_status(p_token text, p_id int, p_status text, p_nota text default '', p_manager_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; o pd_pedidos; v_by int;
begin
  u := _op(p_token);
  select * into o from pd_pedidos where id = p_id for update;
  if o.id is null then perform _err('Pedido não encontrado.', 'NAO_ENCONTRADO'); end if;
  if p_status not in ('novo','confirmado','separando','saiu_entrega','pronto_retirada','entregue','cancelado') then perform _err('Situação inválida.'); end if;
  if o.status in ('entregue','cancelado') then perform _err('Pedido já ' || o.status || '.', 'CONFLITO'); end if;
  if p_status = 'saiu_entrega' and o.modo <> 'entrega' then perform _err('Esse pedido é para retirada.'); end if;
  if p_status = 'pronto_retirada' and o.modo <> 'retirada' then perform _err('Esse pedido é para entrega.'); end if;
  if p_status = 'cancelado' then
    v_by := _authorize_manager(u, p_manager_pin, 'Cancelar pedido');
    update pd_pedidos set status = 'cancelado', cancel_motivo = nullif(trim(coalesce(p_nota, '')), ''), updated_at = now() where id = p_id;
  else
    update pd_pedidos set status = p_status, updated_at = now() where id = p_id;
  end if;
  insert into pd_pedido_eventos(pedido_id, status, nota, user_id) values (p_id, p_status, coalesce(trim(p_nota), ''), u.id);
  perform _audit(u.id, 'PEDIDO_' || upper(p_status), 'pd_pedido', p_id, jsonb_build_object('cliente', o.cliente_nome, 'de', o.status, 'authorized_by', v_by));
  return _pd_json(p_id);
end $$;

-- Entregar + registrar a venda no caixa (tudo ou nada). Usa as funções do próprio caixa:
-- order_save cria a encomenda (aparece na tela Encomendas como concluída) e order_conclude faz a venda
-- (número, baixa de estoque, entrada no caixa aberto do terminal escolhido, troco, fiado).
create or replace function pd_pedido_registrar_venda(p_token text, p_terminal text, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u users; o pd_pedidos; c pd_clientes; v_items jsonb; v_order jsonb; v_res jsonb; v_pay int; v_addr text;
begin
  u := _op(p_token);
  select * into o from pd_pedidos where id = p_id for update;
  if o.id is null then perform _err('Pedido não encontrado.', 'NAO_ENCONTRADO'); end if;
  if o.status = 'cancelado' then perform _err('Pedido cancelado.', 'CONFLITO'); end if;
  if o.sale_id is not null then perform _err('A venda desse pedido já foi registrada.', 'CONFLITO'); end if;
  if coalesce(p_terminal, '') = '' then perform _err('Escolha o caixa (terminal) onde a venda vai entrar.', 'CAIXA_FECHADO'); end if;
  select * into c from pd_clientes where id = o.cliente_id;
  select jsonb_agg(x order by pos) into v_items from (
    select pos, jsonb_build_object('product_id', product_id, 'name', name, 'unit', unit, 'qty', qty, 'line_cents', line_cents) x
      from pd_pedido_itens where pedido_id = o.id
    union all
    select 100000, jsonb_build_object('product_id', null, 'name', 'Taxa de entrega', 'unit', 'UN', 'qty', 1000, 'line_cents', o.taxa_entrega_cents)
     where o.taxa_entrega_cents > 0) s;
  v_addr := case when o.modo = 'entrega' then o.rua || ', ' || o.numero || ' — ' || o.bairro || ', ' || o.cidade ||
              case when o.complemento <> '' then ' (' || o.complemento || ')' else '' end else '' end;
  v_order := order_save(p_token, null, jsonb_build_object('customer_id', c.customer_id, 'customer_name', o.cliente_nome, 'phone', o.phone,
    'items', v_items, 'paid', false, 'delivery', case when o.modo = 'entrega' then 'entrega' else 'buscar' end, 'address', v_addr,
    'note', 'Pedido #' || o.id || ' (app Pedidos)' || case when o.obs <> '' then ' · ' || o.obs else '' end));
  v_pay := case when o.pagamento = 'dinheiro' and o.troco_para_cents is not null then o.troco_para_cents else o.total_cents end;
  v_res := order_conclude(p_token, p_terminal, (v_order->>'id')::int,
    jsonb_build_object('payments', jsonb_build_array(jsonb_build_object('method', o.pagamento, 'amount_cents', v_pay)), 'customer_id', c.customer_id));
  update pd_pedidos set order_id = (v_order->>'id')::int, sale_id = (v_res->'sale'->>'id')::int, pago = true,
    status = 'entregue', updated_at = now() where id = o.id;
  insert into pd_pedido_eventos(pedido_id, status, nota, user_id)
  values (o.id, 'entregue', 'Venda nº ' || coalesce(v_res->'sale'->>'number', '?') || ' registrada no caixa (' || p_terminal || ')', u.id);
  perform _audit(u.id, 'PEDIDO_VENDA', 'pd_pedido', o.id, jsonb_build_object('venda', v_res->'sale'->>'number', 'total', o.total_cents));
  return jsonb_build_object('pedido', _pd_json(o.id), 'sale_number', (v_res->'sale'->>'number')::int, 'change_cents', (v_res->'sale'->>'change_cents')::int);
end $$;

-- ---------- permissões ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'pd\_%' or p.proname like '\_pd\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('pd_config_salvar','pd_cliente_salvar','pd_pedido_salvar','pd_pedido_status','pd_pedido_registrar_venda') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
