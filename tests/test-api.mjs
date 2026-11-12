import { login } from './api.mjs';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('✓', m); } else { fail++; console.log('✗', m); } };
const rej = async (p, re, m) => { try { await p; ok(false, m + ' (não recusou)'); } catch (e) { ok(re.test(e.message), m + ' → ' + (JSON.parse(e.message).message || '').slice(0, 90)); } };
const a = await login('rafael'); const op = await login('joao', 'senha12345', 'CEL-JOAO');
// anon
const an = await a.raw('pd_clientes?select=*'); ok(an.status === 401 || (await an.json()).length === 0, 'anon não lê pd_clientes (' + an.status + ')');
const an2 = await a.raw('v_pd_pedidos?select=*'); ok(an2.status === 401 || (await an2.json()).length === 0, 'anon não lê v_pd_pedidos (' + an2.status + ')');
// cliente incompleto
await rej(a.call('pd_cliente_salvar', { p_token: a.tok, p_id: null, p_data: { phone: '38999990001', name: 'Maria', rua: 'Rua A', numero: '', bairro: '', cidade: 'Paracatu' } }), /incompleto/, 'endereço incompleto recusado');
await rej(a.call('pd_cliente_salvar', { p_token: a.tok, p_id: null, p_data: { phone: '123', name: 'X', rua: 'Rua A', numero: '1', bairro: 'B', cidade: 'C' } }), /Telefone/, 'telefone inválido recusado');
const c = await a.call('pd_cliente_salvar', { p_token: a.tok, p_id: null, p_data: { phone: '(38) 99999-0001', name: 'Maria API', rua: 'Rua das Flores', numero: '10', bairro: 'Centro', cidade: 'Paracatu', uf: 'mg', lat: -17.22, lng: -46.87 } });
ok(c.id && c.phone === '38999990001' && c.uf === 'MG', 'cliente salvo, telefone normalizado');
await rej(a.call('pd_cliente_salvar', { p_token: a.tok, p_id: null, p_data: { phone: '38999990001', name: 'Outra', rua: 'Rua B', numero: '2', bairro: 'Bairro', cidade: 'Cidade' } }), /Já existe/, 'telefone duplicado recusado');
// direto na tabela
const ins = await fetch('http://127.0.0.1:54340/rest/v1/pd_pedidos', { method: 'POST', headers: { apikey: 'x', authorization: 'Bearer ' + a.jwt, 'content-type': 'application/json' }, body: '{}' }); ok(ins.status >= 400, 'insert direto em pd_pedidos negado (' + ins.status + ')');
// pedido
const prods = await a.get('v_products?select=id,name,unit,price_cents,stock_qty&active=eq.true&order=id&limit=3');
const p1 = prods[0], p2 = prods.find(p => p.unit !== 'KG') || prods[1];
const base = { tipo: 'pedido', cliente_id: c.id, modo: 'entrega', pagamento: 'dinheiro', taxa_entrega_cents: 500, itens: [{ product_id: p1.id, qty: 1500 }] };
await rej(a.call('pd_pedido_salvar', { p_token: a.tok, p_id: null, p_data: { ...base, troco_para_cents: 100 } }), /menor que o total/, 'troco menor que total recusado');
await rej(a.call('pd_pedido_salvar', { p_token: a.tok, p_id: null, p_data: { ...base, tipo: 'encomenda' } }), /data e a hora/, 'encomenda sem data recusada');
await rej(a.call('pd_pedido_salvar', { p_token: a.tok, p_id: null, p_data: { ...base, pagamento: '' } }), /pagar/, 'sem forma de pagamento recusado');
await rej(a.call('pd_pedido_salvar', { p_token: a.tok, p_id: null, p_data: { ...base, pagamento: 'fiado' } }), /Fiado/, 'fiado sem cliente do caixa recusado');
const o = await a.call('pd_pedido_salvar', { p_token: a.tok, p_id: null, p_data: { ...base, troco_para_cents: 5000, itens: [{ product_id: p1.id, qty: 1500 }, { product_id: null, name: 'Queijo da roça', unit: 'UN', qty: 1000, unit_price_cents: 2500 }] } });
const exp = Math.round(p1.price_cents * 1.5) + 2500 + 500;
ok(o.total_cents === exp && o.taxa_entrega_cents === 500 && o.troco_para_cents === 5000, 'pedido salvo, total do servidor = ' + o.total_cents + ' (esperado ' + exp + ')');
ok(o.rua === 'Rua das Flores' && o.lat === -17.22, 'endereço e GPS copiados no pedido');
const enc = await a.call('pd_pedido_salvar', { p_token: a.tok, p_id: null, p_data: { ...base, tipo: 'encomenda', modo: 'retirada', pagamento: 'pix', pago: true, agendado_para: new Date(Date.now() + 86400e3).toISOString() } });
ok(enc.tipo === 'encomenda' && enc.rua === '' && enc.taxa_entrega_cents === 0 && enc.pago, 'encomenda retirada: sem endereço/taxa, paga');
await rej(a.call('pd_pedido_status', { p_token: a.tok, p_id: enc.id, p_status: 'saiu_entrega' }), /retirada/, 'saiu_entrega em retirada recusado');
const s1 = await op.call('pd_pedido_status', { p_token: op.tok, p_id: o.id, p_status: 'confirmado' }); ok(s1.status === 'confirmado', 'operador confirma');
await rej(op.call('pd_pedido_status', { p_token: op.tok, p_id: enc.id, p_status: 'cancelado', p_nota: 'teste' }), /gerente/, 'operador cancela sem PIN → recusado');
const cx = await op.call('pd_pedido_status', { p_token: op.tok, p_id: enc.id, p_status: 'cancelado', p_nota: 'desistiu', p_manager_pin: '1234' }); ok(cx.status === 'cancelado' && cx.cancel_motivo === 'desistiu', 'operador cancela com PIN do gerente');
// venda
const st0 = (await a.get('products?select=stock_qty&id=eq.' + p1.id))[0].stock_qty;
await rej(a.call('pd_pedido_registrar_venda', { p_token: a.tok, p_terminal: 'NAO-EXISTE', p_id: o.id }), /Caixa fechado/, 'registrar venda com caixa fechado recusado');
const v = await a.call('pd_pedido_registrar_venda', { p_token: a.tok, p_terminal: 'CAIXA-BALCAO', p_id: o.id });
ok(v.sale_number > 0 && v.change_cents === 5000 - exp && v.pedido.status === 'entregue', 'venda nº ' + v.sale_number + ', troco ' + v.change_cents);
const st1 = (await a.get('products?select=stock_qty&id=eq.' + p1.id))[0].stock_qty; ok(st0 - st1 === 1500, 'estoque baixou 1,5 kg (' + st0 + '→' + st1 + ')');
const ord = (await a.get('v_orders?select=status,sale_number,total_cents&id=eq.' + v.pedido.order_id))[0]; ok(ord && ord.status === 'CONCLUIDA' && ord.total_cents === exp, 'encomenda CONCLUIDA no caixa com o mesmo total');
const pays = await a.get('sale_payments?select=method,amount_cents,net_cents&sale_id=eq.' + v.pedido.sale_id); ok(pays[0].method === 'dinheiro' && pays[0].amount_cents === 5000 && pays[0].net_cents === exp, 'pagamento no caixa: recebeu 50, líquido = total');
await rej(a.call('pd_pedido_registrar_venda', { p_token: a.tok, p_terminal: 'CAIXA-BALCAO', p_id: o.id }), /já foi registrada/, 'venda duplicada recusada');
await rej(a.call('pd_pedido_salvar', { p_token: a.tok, p_id: o.id, p_data: base }), /não dá para alterar/, 'pedido entregue não altera');
await rej(op.call('pd_config_salvar', { p_token: op.tok, p_data: { loja_whatsapp: '38998251455' } }), /permiss/, 'operador não muda config');
console.log(`\n${pass} ok, ${fail} falhas`); process.exit(fail ? 1 : 0);
