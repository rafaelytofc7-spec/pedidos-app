/* Pedidos · Hortifruti Frutos da Roça — v1.0.0
   Pedidos e encomendas ligados ao banco do Folha Caixa: produtos e preços do caixa, clientes pelo telefone,
   endereço completo obrigatório, pagamento com troco, WhatsApp pronto e venda registrada no caixa. */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var LOJA_PADRAO = { loja_nome: 'Hortifruti Frutos da Roça', loja_whatsapp: '38998251455', loja_endereco: 'Rua do Santana, 83 — Paracatuzinho, Paracatu/MG', taxa_entrega_cents: 0, chave_pix: '', horario: '' };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var main = $('#main');
  var S = { products: [], cfg: Object.assign({}, LOJA_PADRAO), fiado: [], orders: [], loadedAt: 0, filter: 'abertos', q: '', draft: null, timer: null };

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function brl(c) { c = Math.round(Number(c) || 0); var s = (Math.abs(c) / 100).toFixed(2).split('.'); return (c < 0 ? '-' : '') + 'R$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1]; }
  function parseMoney(v) { v = String(v || '').replace(/[^\d,.]/g, ''); if (!v) return null; if (v.indexOf(',') >= 0) v = v.replace(/\./g, '').replace(',', '.'); var n = Number(v); return isFinite(n) ? Math.round(n * 100) : null; }
  function moneyInput(c) { return c == null ? '' : (c / 100).toFixed(2).replace('.', ','); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function normPhone(s) { var d = digits(s); if ((d.length === 12 || d.length === 13) && d.slice(0, 2) === '55') d = d.slice(2); return d; }
  function fmtPhone(s) { var d = normPhone(s); if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 3) + '.' + d.slice(3, 7) + '-' + d.slice(7); if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6); return s || ''; }
  function maskPhone(v) { var d = digits(v).slice(0, 11); if (d.length <= 2) return d ? '(' + d : ''; if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2); if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6); return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7); }
  var UN = { KG: 'kg', UN: 'un', BANDEJA: 'bdj', MACO: 'maço', DUZIA: 'dz', PCT: 'pct' };
  function qtyLabel(q, u) { if (u === 'KG') return (q / 1000).toFixed(3).replace('.', ',') + ' kg'; return (q / 1000).toString().replace('.', ',') + ' ' + (UN[u] || String(u).toLowerCase()); }
  function qtyInput(q, u) { return u === 'KG' ? (q / 1000).toFixed(3).replace('.', ',') : String(Math.round(q / 1000)); }
  function parseQty(v, u) { v = String(v || '').replace(',', '.').replace(/[^\d.]/g, ''); var n = Number(v); if (!isFinite(n) || n <= 0) return null; return u === 'KG' ? Math.round(n * 1000) : Math.round(n) * 1000; }
  var TZ = { timeZone: 'America/Sao_Paulo' };
  function fdt(iso, o) { if (!iso) return ''; return new Intl.DateTimeFormat('pt-BR', Object.assign({}, TZ, o || { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })).format(new Date(iso)); }
  function dayKey(iso) { return new Intl.DateTimeFormat('en-CA', Object.assign({}, TZ, { year: 'numeric', month: '2-digit', day: '2-digit' })).format(new Date(iso)); }
  function todayKey() { return dayKey(new Date().toISOString()); }
  function slug(n) { return String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  var FOTOS = {}; (window.PD_FOTOS || []).forEach(function (f) { FOTOS[f] = 'assets/produtos/' + f + '.webp'; });
  function ph(name, icon) { var u = FOTOS[slug(name)]; return u ? '<img src="' + u + '" alt="" loading="lazy">' : esc(icon || '🧺'); }
  function first(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  var PAG = { pix: ['Pix', '⚡'], dinheiro: ['Dinheiro', '💵'], credito: ['Cartão de crédito', '💳'], debito: ['Cartão de débito', '💳'], voucher: ['Vale-alimentação', '🎫'], fiado: ['Fiado (caderneta)', '📒'] };
  var ST = { novo: 'Novo', confirmado: 'Confirmado', separando: 'Separando', saiu_entrega: 'Saiu para entrega', pronto_retirada: 'Pronto p/ retirada', entregue: 'Entregue', cancelado: 'Cancelado' };
  var FINAL = { entregue: 1, cancelado: 1 };
  function flow(o) { return ['novo', 'confirmado', 'separando', o.modo === 'entrega' ? 'saiu_entrega' : 'pronto_retirada', 'entregue']; }
  function badge(st) { return '<span class="badge st-' + st + '">' + esc(ST[st] || st) + '</span>'; }
  function tbadge(t) { return '<span class="badge tp-' + t + '">' + (t === 'encomenda' ? '📅 Encomenda' : '🛒 Pedido') + '</span>'; }
  function addrLine(a) { if (!a || !a.rua) return ''; return a.rua + ', ' + a.numero + ' — ' + a.bairro + ', ' + a.cidade + (a.uf ? '/' + a.uf : ''); }
  function mapsUrl(a) { if (a.lat != null && a.lng != null) return 'https://www.google.com/maps/search/?api=1&query=' + a.lat + ',' + a.lng; return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addrLine(a)); }
  function storeMaps() { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(S.cfg.loja_endereco.replace('—', ',')); }
  function waLink(phone, text) { return 'https://wa.me/55' + normPhone(phone) + '?text=' + encodeURIComponent(text); }
  function price(p) { var n = Date.now(); if (p.promo_price_cents != null && (!p.promo_starts_at || new Date(p.promo_starts_at) <= n) && (!p.promo_ends_at || new Date(p.promo_ends_at) > n)) return p.promo_price_cents; return p.price_cents; }
  function isPromo(p) { return price(p) !== p.price_cents; }
  function pById(id) { return S.products.find(function (p) { return p.id === id; }); }
  var ICON = {
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c1.8.7 3 2.6 3.5 5.4"/>',
    store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10h18M9 20v-6h6v6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    wa: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7L4 20Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2L9 9.5Z"/>',
    gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>'
  };
  function ic(n) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function toast(msg, kind) { var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(function () { t.remove(); }, kind === 'bad' ? 6000 : 3500); }
  var dlg = $('#dialog');
  function openDialog(html, onMount) { dlg.innerHTML = '<div class="dlg">' + html + '</div>'; if (!dlg.open) dlg.showModal(); $$('[data-close]', dlg).forEach(function (b) { b.onclick = function () { dlg.close(); }; }); if (onMount) onMount(dlg); }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.innerHTML; btn.textContent = 'Aguarde…'; } else if (btn.dataset.t) btn.innerHTML = btn.dataset.t; }

  // ---------- dados ----------
  async function loadBase(force) {
    if (!force && Date.now() - S.loadedAt < 60000 && S.products.length) return;
    var r = await Promise.all([
      SB.get('v_products?select=id,code,name,unit,price_cents,promo_price_cents,promo_starts_at,promo_ends_at,icon,category_name,category_color,stock_qty,active&active=eq.true&deleted_at=is.null&order=name'),
      SB.get('pd_config?select=*&id=eq.1').catch(function () { return []; }),
      SB.get('customers?select=id,name,phone,active&active=eq.true&order=name').catch(function () { return []; })
    ]);
    S.products = r[0] || []; if (r[1] && r[1][0]) S.cfg = r[1][0]; S.fiado = r[2] || []; S.loadedAt = Date.now();
    try { localStorage.setItem('pedidos.cfg', JSON.stringify(S.cfg)); } catch (e) { }
    paintStore();
  }
  async function loadOrders() {
    S.orders = await SB.get('v_pd_pedidos?select=*&order=id.desc&limit=500') || [];
    paintCounts();
    return S.orders;
  }
  function paintStore() {
    $('#storeAddrText').textContent = S.cfg.loja_endereco;
    $('#sideFoot').innerHTML = '<b>' + esc(S.cfg.loja_nome) + '</b><span>' + esc(S.cfg.loja_endereco) + '</span><span>WhatsApp ' + esc(fmtPhone(S.cfg.loja_whatsapp)) + '</span><span class="faint">Pedidos v' + VERSION + ' · ligado ao Folha Caixa</span>';
  }
  try { var cc = JSON.parse(localStorage.getItem('pedidos.cfg') || 'null'); if (cc) S.cfg = cc; } catch (e) { }

  // ---------- navegação ----------
  var NAV = [['pedidos', 'Pedidos', 'list'], ['novo', 'Novo pedido', 'plus'], ['agenda', 'Encomendas', 'cal'], ['clientes', 'Clientes', 'users'], ['loja', 'Loja', 'store']];
  function paintNav(cur) {
    $('#nav').innerHTML = NAV.map(function (n) { return '<a href="#/' + n[0] + '"' + (n[0] === 'novo' ? ' class="cta"' : '') + (cur === n[0] ? ' aria-current="page"' : '') + '>' + ic(n[2]) + '<span>' + n[1] + '</span>' + (n[0] === 'pedidos' ? '<span class="count" id="cntSide" hidden></span>' : '') + (n[0] === 'agenda' ? '<span class="count" id="cntAgSide" hidden></span>' : '') + '</a>'; }).join('');
    $('#bnav').innerHTML = NAV.map(function (n) { return '<a href="#/' + n[0] + '"' + (n[0] === 'novo' ? ' class="cta"' : '') + (cur === n[0] ? ' aria-current="page"' : '') + '><span class="bn-ic">' + ic(n[2]) + (n[0] === 'pedidos' ? '<span class="bn-count" id="cntB" hidden></span>' : '') + '</span><span class="bn-l">' + (n[0] === 'novo' ? 'Novo' : n[1]) + '</span></a>'; }).join('');
    paintCounts();
  }
  function paintCounts() {
    var open = S.orders.filter(function (o) { return !FINAL[o.status]; }).length;
    var ag = S.orders.filter(function (o) { return o.tipo === 'encomenda' && !FINAL[o.status]; }).length;
    [['#cntSide', open], ['#cntB', open], ['#cntAgSide', ag]].forEach(function (x) { var el = $(x[0]); if (el) { el.hidden = !x[1]; el.textContent = x[1]; } });
  }
  function route() {
    clearInterval(S.timer);
    var h = location.hash.replace(/^#\/?/, '') || 'pedidos';
    var seg = h.split('/');
    if (!SB.hasSession()) { seg = ['login']; }
    else if (seg[0] === 'login') seg = ['pedidos'];
    document.body.dataset.view = seg[0];
    var me = SB.me(); $('#who').textContent = me ? me.name + ' · ' + me.role : '';
    paintNav(seg[0] === 'pedido' || seg[0] === 'editar' ? 'pedidos' : seg[0]);
    main.innerHTML = '';
    var V = { login: vLogin, pedidos: vPedidos, novo: vNovo, editar: vNovo, pedido: vPedido, agenda: vAgenda, clientes: vClientes, loja: vLoja }[seg[0]] || vPedidos;
    Promise.resolve().then(function () { return V(seg[1]); }).catch(showErr);
    window.scrollTo(0, 0);
  }
  function showErr(e) {
    if (e && /SEM_LOGIN|SEM_PIN|SENHA_DE_NOVO/.test(e.code)) return;
    main.innerHTML = '<div class="alert bad">' + esc(e && e.message || e) + '</div><p><button class="btn" onclick="location.reload()">Tentar de novo</button></p>';
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('pd:auth', async function () { await SB.signOut(); sessionStorage.setItem('pedidos.loginMsg', 'Sua sessão terminou. Entre de novo com usuário e senha.'); location.hash = '#/login'; route(); });
  window.addEventListener('pd:net', function (e) { $('#net').hidden = e.detail; });

  // ---------- login ----------
  function vLogin() {
    var msg = sessionStorage.getItem('pedidos.loginMsg'); sessionStorage.removeItem('pedidos.loginMsg');
    main.innerHTML = '<form class="login panel" id="lf" autocomplete="on">' +
      '<img class="logo" src="icons/logo-frutos-da-roca.png" alt="Logo Hortifruti Frutos da Roça">' +
      '<h1>Pedidos e encomendas</h1><p class="muted">Entre com o mesmo <b>usuário e senha do Folha Caixa</b>.</p>' +
      (msg ? '<div class="alert info">' + esc(msg) + '</div>' : '') +
      '<label class="field"><span class="label">Usuário</span><input class="input" name="u" autocomplete="username" autocapitalize="none" required></label>' +
      '<label class="field"><span class="label">Senha</span><input class="input" name="p" type="password" autocomplete="current-password" required></label>' +
      '<p class="err-msg" id="lerr" hidden></p><button class="btn primary block" id="lbtn">Entrar</button>' +
      '<div class="store-card"><img src="icons/icon-192.png" alt=""><div><b>' + esc(S.cfg.loja_nome) + '</b><span class="small muted">' + esc(S.cfg.loja_endereco) + ' · WhatsApp ' + esc(fmtPhone(S.cfg.loja_whatsapp)) + '</span></div></div></form>';
    $('#lf').onsubmit = async function (ev) {
      ev.preventDefault(); var b = $('#lbtn'); busy(b, true); $('#lerr').hidden = true;
      try { await SB.signIn(this.u.value, this.p.value); toast('Bem-vindo(a)!', 'ok'); location.hash = '#/pedidos'; route(); }
      catch (e) { $('#lerr').textContent = e.message; $('#lerr').hidden = false; }
      finally { busy(b, false); }
    };
  }

  // ---------- lista de pedidos ----------
  var FILTERS = [['abertos', 'Em aberto'], ['hoje', 'Hoje'], ['encomendas', 'Encomendas'], ['entregues', 'Entregues'], ['cancelados', 'Cancelados'], ['todos', 'Todos']];
  function matchF(o, f) {
    if (f === 'abertos') return !FINAL[o.status];
    if (f === 'hoje') return o.local_date === todayKey() || (o.agendado_para && dayKey(o.agendado_para) === todayKey());
    if (f === 'encomendas') return o.tipo === 'encomenda' && !FINAL[o.status];
    if (f === 'entregues') return o.status === 'entregue';
    if (f === 'cancelados') return o.status === 'cancelado';
    return true;
  }
  function isLate(o) { return o.agendado_para && !FINAL[o.status] && new Date(o.agendado_para) < new Date(); }
  function ocard(o) {
    var n = (o.itens || []).length;
    return '<a class="ocard' + (isLate(o) ? ' late' : '') + '" href="#/pedido/' + o.id + '" data-id="' + o.id + '"><div class="top"><div><div class="num">#' + o.id + ' · ' + esc(fdt(o.created_at)) + '</div><h3>' + esc(o.cliente_nome) + '</h3></div>' + badge(o.status) + '</div>' +
      '<div class="meta">' + tbadge(o.tipo) + '<span>' + (o.modo === 'entrega' ? '🚚 Entrega · ' + esc(o.bairro) : '🏪 Retirada') + '</span>' +
      (o.agendado_para ? '<span' + (isLate(o) ? ' style="color:var(--red);font-weight:700"' : '') + '>📅 ' + esc(fdt(o.agendado_para)) + (isLate(o) ? ' · atrasada' : '') + '</span>' : '') + '</div>' +
      '<div class="meta"><span>' + n + ' ite' + (n === 1 ? 'm' : 'ns') + '</span><span>·</span><span>' + esc(PAG[o.pagamento][0]) + (o.troco_para_cents ? ' (troco p/ ' + brl(o.troco_para_cents) + ')' : '') + (o.pago ? ' · pago' : '') + '</span>' + (o.sale_number ? '<span>· venda nº ' + o.sale_number + '</span>' : '') + '<span class="grow"></span><span class="tot">' + brl(o.total_cents) + '</span></div></a>';
  }
  async function vPedidos() {
    main.innerHTML = '<div class="sec-head"><div><div class="eyebrow">' + esc(S.cfg.loja_nome) + '</div><h1>Pedidos</h1><p>Pedidos de entrega/retirada e encomendas, com o catálogo e os preços do caixa.</p></div><a class="btn primary" href="#/novo">' + ic('plus') + 'Novo pedido</a></div>' +
      '<div class="stats" id="stats"></div><div class="toolbar"><label class="search">' + ic('search') + '<input class="input" id="q" type="search" placeholder="Buscar por nome, telefone ou nº" value="' + esc(S.q) + '" aria-label="Buscar pedidos"></label><div class="chips" id="chips"></div></div><div id="list"><p class="muted">Carregando…</p></div>';
    var paint = function () {
      var t = S.q.trim().toLowerCase(), td = digits(t);
      var L = S.orders.filter(function (o) { return matchF(o, S.filter); }).filter(function (o) {
        if (!t) return true; return ('#' + o.id) === t || String(o.id) === t || o.cliente_nome.toLowerCase().indexOf(t) >= 0 || (td.length >= 3 && o.phone.indexOf(td) >= 0) || (o.bairro || '').toLowerCase().indexOf(t) >= 0;
      });
      $('#chips').innerHTML = FILTERS.map(function (f) { var c = S.orders.filter(function (o) { return matchF(o, f[0]); }).length; return '<button class="chip" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + ' <span class="c">' + c + '</span></button>'; }).join('');
      $$('#chips .chip').forEach(function (b) { b.onclick = function () { S.filter = b.dataset.f; paint(); }; });
      var open = S.orders.filter(function (o) { return !FINAL[o.status]; });
      var hojeEnt = S.orders.filter(function (o) { return o.status === 'entregue' && dayKey(o.updated_at) === todayKey(); });
      $('#stats').innerHTML = '<div class="stat"><b>' + open.filter(function (o) { return o.status === 'novo'; }).length + '</b><span>Novos (confirmar)</span></div><div class="stat"><b>' + open.filter(function (o) { return o.tipo === 'encomenda'; }).length + '</b><span>Encomendas abertas</span></div><div class="stat"><b>' + open.filter(function (o) { return o.status === 'saiu_entrega'; }).length + '</b><span>Saíram p/ entrega</span></div><div class="stat"><b>' + brl(hojeEnt.reduce(function (s, o) { return s + o.total_cents; }, 0)) + '</b><span>Entregue hoje (' + hojeEnt.length + ')</span></div>';
      $('#list').innerHTML = L.length ? '<div class="orders">' + L.map(ocard).join('') + '</div>' : '<div class="empty"><div style="font-size:40px">🧺</div><h3>Nenhum pedido aqui</h3><p>' + (S.orders.length ? 'Troque o filtro ou a busca.' : 'Comece pelo botão Novo pedido.') + '</p></div>';
    };
    $('#q').oninput = function () { S.q = this.value; paint(); };
    await Promise.all([loadBase(), loadOrders()]); paint();
    S.timer = setInterval(function () { if (document.body.dataset.view === 'pedidos') loadOrders().then(paint).catch(function () { }); }, 30000);
  }

  // ---------- novo / editar pedido ----------
  function newDraft() { return { id: null, tipo: 'pedido', cliente: null, modo: 'entrega', itens: [], agendado_para: '', pagamento: '', troco: false, troco_para: null, pago: false, cobrar_taxa: true, taxa: null, obs: '' }; }
  function saveDraft() { try { sessionStorage.setItem('pedidos.draft', JSON.stringify(S.draft)); } catch (e) { } }
  function calc(d) {
    var sub = d.itens.reduce(function (s, it) { return s + Math.round(it.unit_price_cents * it.qty / 1000); }, 0);
    var taxa = d.modo === 'entrega' && d.cobrar_taxa ? (d.taxa != null ? d.taxa : S.cfg.taxa_entrega_cents || 0) : 0;
    return { sub: sub, taxa: taxa, total: sub + taxa };
  }
  function toLocalInput(iso) { if (!iso) return ''; var d = new Date(iso); var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  async function vNovo(editId) {
    main.innerHTML = '<p class="muted">Carregando catálogo do caixa…</p>';
    await loadBase();
    if (editId) {
      var o = (await SB.get('v_pd_pedidos?select=*&id=eq.' + Number(editId)))[0];
      if (!o) throw new Error('Pedido não encontrado.');
      if (FINAL[o.status] || o.sale_id) { location.hash = '#/pedido/' + o.id; return; }
      var c0 = (await SB.get('pd_clientes?select=*&id=eq.' + o.cliente_id))[0];
      S.draft = { id: o.id, tipo: o.tipo, cliente: c0, modo: o.modo, agendado_para: toLocalInput(o.agendado_para), pagamento: o.pagamento, troco: !!o.troco_para_cents, troco_para: o.troco_para_cents,
        pago: o.pago, cobrar_taxa: o.modo !== 'entrega' || o.taxa_entrega_cents > 0, taxa: o.taxa_entrega_cents, obs: o.obs,
        itens: o.itens.map(function (i) { var p = i.product_id && pById(i.product_id); return { product_id: i.product_id, name: i.name, unit: i.unit, icon: i.icon, qty: i.qty, unit_price_cents: p ? price(p) : i.unit_price_cents }; }) };
    } else {
      var saved = null; try { saved = JSON.parse(sessionStorage.getItem('pedidos.draft') || 'null'); } catch (e) { }
      if (!S.draft || S.draft.id) S.draft = saved && !saved.id ? saved : newDraft();
    }
    var d = S.draft;
    main.innerHTML = '<div class="sec-head"><div><div class="eyebrow">' + (d.id ? 'Editar pedido #' + d.id : esc(S.cfg.loja_nome)) + '</div><h1>' + (d.id ? 'Editar pedido' : 'Novo pedido') + '</h1><p>Cliente pelo telefone → itens → entrega ou retirada → pagamento.</p></div>' + (d.id ? '<a class="btn ghost" href="#/pedido/' + d.id + '">Voltar</a>' : '<button class="btn ghost" id="clearDraft">Limpar</button>') + '</div>' +
      '<div class="np"><div class="stack">' +
      '<section class="panel" id="secTipo"><h2><span class="n">1</span>Tipo</h2><div class="seg" id="segTipo"><button data-v="pedido">🛒 Pedido (agora)</button><button data-v="encomenda">📅 Encomenda (agendar)</button></div><div id="agWrap" class="field" style="margin-top:12px"><span class="label">Data e hora combinadas <span class="req">*</span></span><input class="input" id="ag" type="datetime-local" style="max-width:280px"><p class="hint">Para quando o cliente quer receber ou buscar.</p></div></section>' +
      '<section class="panel" id="secCli"><h2><span class="n">2</span>Cliente</h2><div id="cli"></div></section>' +
      '<section class="panel" id="secItens"><h2><span class="n">3</span>Itens <span class="faint small" style="font-weight:400">preços do caixa</span></h2><div class="items" id="items"></div>' +
      '<div class="row" style="margin:12px 0 8px"><label class="search grow" style="max-width:none">' + ic('search') + '<input class="input" id="pq" type="search" placeholder="Buscar produto (ex.: tomate)" aria-label="Buscar produto"></label><button class="btn" id="avulso">+ Item avulso</button></div><div class="prods" id="prods"></div></section>' +
      '<section class="panel" id="secEnt"><h2><span class="n">4</span>Entrega ou retirada</h2><div class="seg" id="segModo"><button data-v="entrega">🚚 Entrega</button><button data-v="retirada">🏪 Retirar na loja</button></div><div id="ent" style="margin-top:12px"></div></section>' +
      '<section class="panel" id="secPag"><h2><span class="n">5</span>Pagamento</h2><div class="pay-grid" id="pays"></div><div id="payx" style="margin-top:12px"></div></section>' +
      '<section class="panel"><h2><span class="n">6</span>Observações</h2><textarea class="textarea" id="obs" placeholder="Ex.: banana mais verde, interfone não funciona, entregar depois das 17h…"></textarea></section>' +
      '</div><aside class="panel summary" id="sum"></aside></div>' +
      '<div class="mobile-bar" id="mbar"><div class="t" id="mbt"></div><button class="btn primary" id="msave">Salvar pedido</button></div>';
    if ($('#clearDraft')) $('#clearDraft').onclick = function () { if (confirm('Limpar o pedido em andamento?')) { S.draft = newDraft(); saveDraft(); route(); } };
    var paintTipo = function () { $$('#segTipo button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === d.tipo); }); $('#agWrap').hidden = d.tipo !== 'encomenda'; };
    $$('#segTipo button').forEach(function (b) { b.onclick = function () { d.tipo = b.dataset.v; paintTipo(); saveDraft(); paintSum(); }; });
    $('#ag').value = d.agendado_para || ''; $('#ag').oninput = function () { d.agendado_para = this.value; saveDraft(); paintSum(); };
    $('#obs').value = d.obs || ''; $('#obs').oninput = function () { d.obs = this.value; saveDraft(); };
    paintTipo();
    var setCli = function (nc) { d.cliente = nc; saveDraft(); paintCli(); paintModo(); paintPays(); paintSum(); };
    var paintCli = function () {
      var c = d.cliente, el = $('#cli');
      if (c) {
        el.innerHTML = '<div class="cust-card"><div class="av">' + esc(first(c.name).slice(0, 1).toUpperCase()) + '</div><div class="grow"><b>' + esc(c.name) + '</b><div class="small muted">' + esc(fmtPhone(c.phone)) + '</div><div class="small">' + esc(addrLine(c)) + (c.complemento ? ' · ' + esc(c.complemento) : '') + (c.referencia ? '<br><span class="faint">Ref.: ' + esc(c.referencia) + '</span>' : '') + '</div>' + (c.lat != null ? '<a class="small map-link" target="_blank" rel="noopener" href="' + mapsUrl(c) + '">📍 Localização salva (abrir no mapa)</a>' : '<span class="small faint">Sem localização GPS (opcional)</span>') + '</div><div class="stack" style="gap:6px"><button class="btn sm" id="cEdit">Editar</button><button class="btn sm ghost" id="cSwap">Trocar</button></div></div>';
        $('#cEdit').onclick = function () { clienteDialog(c, setCli); };
        $('#cSwap').onclick = function () { setCli(null); };
      } else {
        el.innerHTML = '<div class="row"><label class="field grow" style="max-width:300px"><span class="label">Telefone / WhatsApp do cliente <span class="req">*</span></span><input class="input" id="tel" inputmode="tel" autocomplete="tel" placeholder="(38) 9.9999-9999"></label><button class="btn leaf" id="telGo" style="align-self:flex-end">' + ic('search') + 'Buscar</button></div><p class="hint" style="margin-top:6px">O cadastro é pelo número. Se não existir, abre o cadastro com endereço completo.</p><div id="telRes"></div>';
        var tel = $('#tel');
        var go = async function () {
          var n = normPhone(tel.value);
          if (n.length < 10) { $('#telRes').innerHTML = '<p class="err-msg">Digite o telefone com DDD (10 ou 11 números).</p>'; return; }
          $('#telRes').innerHTML = '<p class="muted small">Procurando…</p>';
          try {
            var r = await SB.get('pd_clientes?select=*&phone=eq.' + n);
            if (r[0]) { setCli(r[0]); toast('Cliente encontrado: ' + r[0].name, 'ok'); }
            else { $('#telRes').innerHTML = '<div class="alert info" style="margin-top:10px">Nenhum cliente com ' + esc(fmtPhone(n)) + '. Cadastre agora.</div>'; clienteDialog({ phone: n }, setCli); }
          } catch (e) { $('#telRes').innerHTML = '<p class="err-msg">' + esc(e.message) + '</p>'; }
        };
        tel.oninput = function () { tel.value = maskPhone(tel.value); if (digits(tel.value).length === 11) go(); };
        $('#telGo').onclick = go; tel.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      }
    };
    var paintItems = function () {
      $('#items').innerHTML = d.itens.length ? d.itens.map(function (it, i) {
        return '<div class="item" data-i="' + i + '"><div class="ph">' + ph(it.name, it.icon) + '</div><div class="nm">' + esc(it.name) + '<small>' + brl(it.unit_price_cents) + ' / ' + (UN[it.unit] || it.unit) + (it.product_id ? '' : ' · avulso') + '</small></div>' +
          '<div class="qty"><button type="button" data-d="-1" aria-label="Menos">−</button><input class="input" inputmode="decimal" value="' + qtyInput(it.qty, it.unit) + '" aria-label="Quantidade de ' + esc(it.name) + ' em ' + (UN[it.unit] || it.unit) + '"><button type="button" data-d="1" aria-label="Mais">+</button></div>' +
          '<div class="ln">' + brl(Math.round(it.unit_price_cents * it.qty / 1000)) + '</div><button class="icon-btn" data-rm aria-label="Tirar ' + esc(it.name) + '">' + ic('x') + '</button></div>';
      }).join('') : '<p class="muted small" style="margin:0">Nenhum item ainda. Toque nos produtos abaixo.</p>';
      $$('#items .item').forEach(function (row) {
        var it = d.itens[Number(row.dataset.i)], step = it.unit === 'KG' ? 500 : 1000;
        $$('[data-d]', row).forEach(function (b) { b.onclick = function () { it.qty = Math.max(it.unit === 'KG' ? 100 : 1000, it.qty + Number(b.dataset.d) * step); changed(); }; });
        var inp = $('input', row); inp.onchange = function () { var q = parseQty(inp.value, it.unit); if (q) it.qty = q; changed(); };
        $('[data-rm]', row).onclick = function () { d.itens.splice(Number(row.dataset.i), 1); changed(); };
      });
    };
    var changed = function () { saveDraft(); paintItems(); paintProds(); paintPayX(); paintSum(); };
    var paintProds = function () {
      var t = slug($('#pq').value).replace(/-/g, ' ');
      var L = S.products.filter(function (p) { return !t || slug(p.name).replace(/-/g, ' ').indexOf(t) >= 0 || (p.code || '') === t; });
      $('#prods').innerHTML = L.map(function (p) { var inq = d.itens.find(function (i) { return i.product_id === p.id; }); return '<button type="button" class="prod" data-id="' + p.id + '">' + (isPromo(p) ? '<span class="promo">PROMO</span>' : '') + (inq ? '<span class="inq">' + qtyLabel(inq.qty, inq.unit) + '</span>' : '') + '<span class="ph">' + ph(p.name, p.icon) + '</span><span>' + esc(p.name) + '</span><span class="pr">' + brl(price(p)) + '/' + (UN[p.unit] || p.unit) + '</span></button>'; }).join('') || '<p class="muted small">Nenhum produto com esse nome.</p>';
      $$('#prods .prod').forEach(function (b) { b.onclick = function () {
        var p = pById(Number(b.dataset.id)); var ex = d.itens.find(function (i) { return i.product_id === p.id; });
        if (ex) ex.qty += 1000; else d.itens.push({ product_id: p.id, name: p.name, unit: p.unit, icon: p.icon, qty: 1000, unit_price_cents: price(p) });
        changed(); if (navigator.vibrate) navigator.vibrate(10);
      }; });
    };
    $('#pq').oninput = paintProds;
    $('#avulso').onclick = function () {
      openDialog('<h2>Item avulso</h2><p class="muted small" style="margin:0">Para algo que não está no cadastro do caixa (ex.: queijo da roça).</p><label class="field"><span class="label">Nome</span><input class="input" id="avN"></label><div class="grid2 keep"><label class="field"><span class="label">Vende por</span><select class="select" id="avU"><option value="UN">Unidade</option><option value="KG">Quilo</option></select></label><label class="field"><span class="label">Quantidade</span><input class="input" id="avQ" inputmode="decimal" value="1"></label></div><label class="field"><span class="label">Preço (por un/kg)</span><input class="input" id="avP" inputmode="decimal" placeholder="0,00"></label><p class="err-msg" id="avE" hidden></p><div class="foot"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="avOk">Adicionar</button></div>', function () {
        $('#avOk').onclick = function () {
          var n = $('#avN').value.trim(), u = $('#avU').value, q = parseQty($('#avQ').value, u), p = parseMoney($('#avP').value);
          var err = !n ? 'Escreva o nome do item.' : !q ? 'Quantidade inválida.' : (p == null || p <= 0) ? 'Informe o preço.' : '';
          if (err) { $('#avE').textContent = err; $('#avE').hidden = false; return; }
          d.itens.push({ product_id: null, name: n, unit: u, icon: '🧺', qty: q, unit_price_cents: p }); dlg.close(); changed();
        };
      });
    };
    var paintModo = function () {
      $$('#segModo button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === d.modo); });
      var c = calc(d);
      $('#ent').innerHTML = d.modo === 'entrega'
        ? '<p class="small muted" style="margin:0 0 10px">Entrega no endereço do cadastro' + (d.cliente ? ': <b style="color:var(--text)">' + esc(addrLine(d.cliente)) + '</b>' : ' (escolha o cliente).') + '</p><div class="row"><label class="row small" style="gap:8px"><input type="checkbox" id="cobra"' + (d.cobrar_taxa ? ' checked' : '') + '> Cobrar taxa de entrega</label><label class="field" style="max-width:160px"><span class="label">Taxa</span><input class="input" id="taxa" inputmode="decimal" value="' + moneyInput(c.taxa) + '"' + (d.cobrar_taxa ? '' : ' disabled') + '></label></div>'
        : '<div class="store-card"><img src="icons/icon-192.png" alt=""><div><b>Retirar na loja · ' + esc(S.cfg.loja_nome) + '</b><span class="small muted">' + esc(S.cfg.loja_endereco) + (S.cfg.horario ? ' · ' + esc(S.cfg.horario) : '') + '</span><br><a class="small map-link" target="_blank" rel="noopener" href="' + storeMaps() + '">Ver no mapa</a></div></div>';
      if ($('#cobra')) { $('#cobra').onchange = function () { d.cobrar_taxa = this.checked; saveDraft(); paintModo(); paintPayX(); paintSum(); }; $('#taxa').onchange = function () { var v = parseMoney(this.value); d.taxa = v == null ? 0 : v; saveDraft(); paintPayX(); paintSum(); }; }
    };
    $$('#segModo button').forEach(function (b) { b.onclick = function () { d.modo = b.dataset.v; saveDraft(); paintModo(); paintPayX(); paintSum(); }; });
    var paintPays = function () {
      var hasFiado = d.cliente && d.cliente.customer_id;
      if (d.pagamento === 'fiado' && !hasFiado) d.pagamento = '';
      $('#pays').innerHTML = Object.keys(PAG).filter(function (k) { return k !== 'fiado' || hasFiado; }).map(function (k) { return '<button type="button" class="pay" data-v="' + k + '" aria-pressed="' + (d.pagamento === k) + '"><span class="e">' + PAG[k][1] + '</span>' + PAG[k][0] + '</button>'; }).join('');
      $$('#pays .pay').forEach(function (b) { b.onclick = function () { d.pagamento = b.dataset.v; if (d.pagamento !== 'dinheiro') { d.troco = false; d.troco_para = null; } if (d.pagamento === 'dinheiro' || d.pagamento === 'fiado') d.pago = false; saveDraft(); paintPays(); paintPayX(); paintSum(); }; });
    };
    var paintPayX = function () {
      var el = $('#payx'), t = calc(d).total;
      if (d.pagamento === 'dinheiro') {
        var sugg = [2000, 5000, 10000, 20000].filter(function (v) { return v > t; }).slice(0, 3);
        el.innerHTML = '<div class="field"><span class="label">Vai precisar de troco?</span><div class="seg" id="segTroco"><button data-v="0" aria-pressed="' + !d.troco + '">Não, valor certo</button><button data-v="1" aria-pressed="' + d.troco + '">Sim, precisa de troco</button></div></div>' +
          (d.troco ? '<div class="row" style="margin-top:10px;align-items:flex-end"><label class="field" style="max-width:200px"><span class="label">Troco para quanto? <span class="req">*</span></span><input class="input" id="trocoP" inputmode="decimal" placeholder="Ex.: 50,00" value="' + moneyInput(d.troco_para) + '"></label>' + sugg.map(function (v) { return '<button type="button" class="chip" data-s="' + v + '">' + brl(v) + '</button>'; }).join('') + '</div><div id="trocoR" style="margin-top:8px"></div>' : '');
        $$('#segTroco button').forEach(function (b) { b.onclick = function () { d.troco = b.dataset.v === '1'; if (!d.troco) d.troco_para = null; saveDraft(); paintPayX(); paintSum(); }; });
        var tr = $('#trocoP');
        var res = function () { var r = $('#trocoR'); if (!r) return; if (d.troco_para == null) r.innerHTML = '<p class="hint">Digite a nota que o cliente vai usar.</p>'; else if (d.troco_para < t) r.innerHTML = '<p class="err-msg">' + brl(d.troco_para) + ' é menor que o total (' + brl(t) + ').</p>'; else r.innerHTML = 'Levar de troco: <span class="change" id="trocoV">' + brl(d.troco_para - t) + '</span>'; };
        if (tr) { tr.oninput = function () { d.troco_para = parseMoney(tr.value); saveDraft(); res(); paintSum(); }; $$('[data-s]', el).forEach(function (b) { b.onclick = function () { d.troco_para = Number(b.dataset.s); saveDraft(); paintPayX(); paintSum(); }; }); res(); }
      } else if (d.pagamento && d.pagamento !== 'fiado') {
        el.innerHTML = '<label class="row small" style="gap:8px"><input type="checkbox" id="pago"' + (d.pago ? ' checked' : '') + '> Já está pago (ex.: Pix adiantado)</label>' + (d.pagamento === 'pix' && S.cfg.chave_pix ? '<p class="hint" style="margin-top:6px">Chave Pix da loja vai na mensagem: ' + esc(S.cfg.chave_pix) + '</p>' : '');
        $('#pago').onchange = function () { d.pago = this.checked; saveDraft(); paintSum(); };
      } else if (d.pagamento === 'fiado') {
        var fc = S.fiado.find(function (x) { return x.id === (d.cliente && d.cliente.customer_id); });
        el.innerHTML = '<p class="hint">Vai para a caderneta de ' + esc(fc ? fc.name : 'cliente do fiado') + ' quando a venda for registrada no caixa (respeita o limite).</p>';
      } else el.innerHTML = '<p class="hint">Escolha como o cliente vai pagar.</p>';
    };
    var problems = function () {
      var p = [], t = calc(d).total;
      if (d.tipo === 'encomenda' && !d.agendado_para) p.push(['secTipo', 'Encomenda: escolha a data e a hora.']);
      if (!d.cliente) p.push(['secCli', 'Escolha o cliente pelo telefone.']);
      if (!d.itens.length) p.push(['secItens', 'Coloque pelo menos um item.']);
      if (!d.pagamento) p.push(['secPag', 'Escolha a forma de pagamento.']);
      if (d.pagamento === 'dinheiro' && d.troco && (d.troco_para == null || d.troco_para < t)) p.push(['secPag', d.troco_para == null ? 'Diga para quanto é o troco.' : 'O troco precisa ser para um valor maior ou igual ao total (' + brl(t) + ').']);
      return p;
    };
    var paintSum = function () {
      var c = calc(d), n = d.itens.length;
      $('#sum').innerHTML = '<h3>Resumo</h3><div class="kv"><span>' + n + ' ite' + (n === 1 ? 'm' : 'ns') + '</span><b>' + brl(c.sub) + '</b>' + (d.modo === 'entrega' ? '<span>Taxa de entrega</span><b>' + brl(c.taxa) + '</b>' : '<span>Retirada na loja</span><b>—</b>') + '<hr><span>Total</span><b class="tot">' + brl(c.total) + '</b>' +
        (d.pagamento ? '<span>Pagamento</span><b style="font-family:var(--font)">' + esc(PAG[d.pagamento][0]) + (d.pago ? ' (pago)' : '') + '</b>' : '') +
        (d.pagamento === 'dinheiro' && d.troco && d.troco_para >= c.total ? '<span>Troco para ' + brl(d.troco_para) + '</span><b style="color:var(--green)">' + brl(d.troco_para - c.total) + '</b>' : '') + '</div>' +
        '<div id="sumErr" style="margin-top:12px"></div><button class="btn primary block" id="save" style="margin-top:8px">' + (d.id ? 'Salvar alterações' : 'Salvar pedido') + '</button>';
      $('#mbt').innerHTML = brl(c.total) + '<small>' + n + ' ite' + (n === 1 ? 'm' : 'ns') + (d.cliente ? ' · ' + esc(first(d.cliente.name)) : '') + '</small>';
      $('#save').onclick = doSave;
    };
    var doSave = async function () {
      var p = problems(), box = $('#sumErr');
      if (p.length) { box.innerHTML = '<div class="alert bad">' + p.map(function (x) { return esc(x[1]); }).join('<br>') + '</div>'; var s = document.getElementById(p[0][0]); if (s) s.scrollIntoView({ block: 'start' }); toast(p[0][1], 'bad'); return; }
      var btn = $('#save'), mb = $('#msave'); busy(btn, true); busy(mb, true);
      var c = calc(d);
      try {
        var r = await SB.rpc('pd_pedido_salvar', { p_token: SB.opToken(), p_id: d.id, p_data: {
          tipo: d.tipo, cliente_id: d.cliente.id, modo: d.modo, agendado_para: d.tipo === 'encomenda' && d.agendado_para ? new Date(d.agendado_para).toISOString() : null,
          pagamento: d.pagamento, troco_para_cents: d.pagamento === 'dinheiro' && d.troco ? d.troco_para : null, pago: d.pago,
          cobrar_taxa: d.modo === 'entrega' && d.cobrar_taxa, taxa_entrega_cents: c.taxa, obs: d.obs,
          itens: d.itens.map(function (i) { return { product_id: i.product_id, name: i.name, unit: i.unit, qty: i.qty, unit_price_cents: i.product_id ? null : i.unit_price_cents }; }) } });
        if (r.total_cents !== c.total) toast('Preço atualizado pelo caixa: total ' + brl(r.total_cents), 'ok');
        S.draft = null; sessionStorage.removeItem('pedidos.draft');
        toast((d.id ? 'Pedido atualizado' : 'Pedido #' + r.id + ' salvo') + '. Mande a confirmação no WhatsApp.', 'ok');
        sessionStorage.setItem('pedidos.justSaved', String(r.id));
        location.hash = '#/pedido/' + r.id;
      } catch (e) { box.innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; toast(e.message, 'bad'); }
      finally { busy(btn, false); busy(mb, false); }
    };
    $('#msave').onclick = function () { doSave(); };
    paintCli(); paintItems(); paintProds(); paintModo(); paintPays(); paintPayX(); paintSum();
  }

  // ---------- cadastro de cliente (endereço completo obrigatório) ----------
  var REQ = [['name', 'Nome'], ['rua', 'Rua'], ['numero', 'Número'], ['bairro', 'Bairro'], ['cidade', 'Cidade']];
  function clienteDialog(c, done) {
    c = Object.assign({ name: '', phone: '', rua: '', numero: '', bairro: '', cidade: 'Paracatu', uf: 'MG', cep: '', complemento: '', referencia: '', lat: null, lng: null, customer_id: null, note: '' }, c || {});
    var loc = { lat: c.lat, lng: c.lng, acc: c.loc_precisao };
    var f = function (k, l, req, attrs) { return '<label class="field"><span class="label">' + l + (req ? ' <span class="req">*</span>' : '') + '</span><input class="input" name="' + k + '" value="' + esc(c[k] || '') + '" ' + (attrs || '') + '></label>'; };
    openDialog('<h2>' + (c.id ? 'Editar cliente' : 'Cadastrar cliente') + '</h2><p class="hint" style="margin:-6px 0 0">Endereço completo é obrigatório (rua, número, bairro e cidade).</p><div id="cErr"></div><form id="cf" class="stack" novalidate>' +
      '<div class="grid2">' + f('phone', 'Telefone / WhatsApp', true, 'inputmode="tel" autocomplete="tel"') + f('name', 'Nome', true, 'autocomplete="name"') + '</div>' +
      '<div class="grid3"><div class="span2">' + f('rua', 'Rua / avenida', true, 'autocomplete="address-line1" placeholder="Ex.: Rua do Santana"') + '</div>' + f('numero', 'Número', true, 'placeholder="Ex.: 83 ou S/N"') + '</div>' +
      '<div class="grid3">' + f('bairro', 'Bairro', true) + f('cidade', 'Cidade', true) + '<div class="grid2 keep">' + f('uf', 'UF', true, 'maxlength="2" style="text-transform:uppercase"') + f('cep', 'CEP', false, 'inputmode="numeric" placeholder="opcional"') + '</div></div>' +
      '<div class="grid2">' + f('complemento', 'Complemento', false, 'placeholder="Casa, apto, bloco (opcional)"') + f('referencia', 'Ponto de referência', false, 'placeholder="Perto de… (opcional)"') + '</div>' +
      '<div class="panel" style="padding:12px;background:var(--bg-2)"><div class="row"><button type="button" class="btn sm" id="gps">' + ic('gps') + 'Usar localização atual (opcional)</button><span class="small muted grow" id="gpsS">' + (loc.lat != null ? '📍 Salva: ' + Number(loc.lat).toFixed(5) + ', ' + Number(loc.lng).toFixed(5) : 'Sem localização — o endereço escrito já basta.') + '</span><button type="button" class="btn sm ghost" id="gpsX"' + (loc.lat == null ? ' hidden' : '') + '>Tirar</button></div><p class="hint" style="margin-top:6px">Só use se estiver no local do cliente (ou se ele mandou a localização).</p></div>' +
      (S.fiado.length ? '<label class="field"><span class="label">Cliente do fiado no caixa (opcional)</span><select class="select" name="customer_id"><option value="">— não ligar —</option>' + S.fiado.map(function (x) { return '<option value="' + x.id + '"' + (x.id === c.customer_id ? ' selected' : '') + '>' + esc(x.name) + (x.phone ? ' · ' + esc(fmtPhone(x.phone)) : '') + '</option>'; }).join('') + '</select><span class="hint">Liga ao cadastro do fiado para poder pagar na caderneta.</span></label>' : '') +
      '<div class="foot"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="cOk">Salvar cliente</button></div></form>', function () {
      var form = $('#cf'); form.phone.value = maskPhone(c.phone);
      form.phone.oninput = function () { form.phone.value = maskPhone(form.phone.value); };
      $('#gps').onclick = function () {
        if (!navigator.geolocation) { $('#gpsS').textContent = 'Este aparelho não dá localização.'; return; }
        $('#gpsS').textContent = 'Pegando a localização…';
        navigator.geolocation.getCurrentPosition(function (p) { loc = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }; $('#gpsS').innerHTML = '📍 ' + loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) + ' (±' + loc.acc + ' m) · <a class="map-link" target="_blank" rel="noopener" href="' + mapsUrl(loc) + '">ver</a>'; $('#gpsX').hidden = false; },
          function (e) { $('#gpsS').textContent = e.code === 1 ? 'Permissão negada. Libere a localização no navegador (opcional).' : 'Não deu para pegar a localização agora.'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      };
      $('#gpsX').onclick = function () { loc = { lat: null, lng: null, acc: null }; $('#gpsS').textContent = 'Sem localização.'; $('#gpsX').hidden = true; };
      form.onsubmit = async function (ev) {
        ev.preventDefault();
        $$('.input', form).forEach(function (i) { i.classList.remove('bad'); });
        var v = {}; ['phone', 'name', 'rua', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'complemento', 'referencia'].forEach(function (k) { v[k] = form[k].value.trim(); });
        v.uf = v.uf.toUpperCase();
        var falta = REQ.filter(function (r) { return !v[r[0]]; });
        var errs = [];
        if (normPhone(v.phone).length < 10) { errs.push('Telefone com DDD (10 ou 11 números).'); form.phone.classList.add('bad'); }
        falta.forEach(function (r) { form[r[0]].classList.add('bad'); });
        if (falta.length) errs.push('Endereço incompleto: falta ' + falta.map(function (r) { return r[1].toLowerCase(); }).join(', ') + '.');
        if (v.rua && v.rua.length < 3) { errs.push('Escreva o nome da rua.'); form.rua.classList.add('bad'); }
        if (!/^[A-Z]{2}$/.test(v.uf)) { errs.push('UF com 2 letras (ex.: MG).'); form.uf.classList.add('bad'); }
        if (v.cep && digits(v.cep).length !== 8) { errs.push('CEP com 8 números (ou deixe vazio).'); form.cep.classList.add('bad'); }
        if (errs.length) { $('#cErr').innerHTML = '<div class="alert bad" id="cErrBox">' + errs.map(esc).join('<br>') + '</div>'; var b1 = $('.input.bad', form); if (b1) b1.focus({ preventScroll: true }); $('.dlg').scrollTop = 0; return; }
        v.phone = normPhone(v.phone); v.lat = loc.lat; v.lng = loc.lng; v.loc_precisao = loc.acc; v.customer_id = form.customer_id ? (form.customer_id.value ? Number(form.customer_id.value) : null) : c.customer_id; v.note = c.note || '';
        var btn = $('#cOk'); busy(btn, true);
        try { var r = await SB.rpc('pd_cliente_salvar', { p_token: SB.opToken(), p_id: c.id || null, p_data: v }); dlg.close(); toast('Cliente salvo: ' + r.name, 'ok'); if (done) done(r); }
        catch (e) { $('#cErr').innerHTML = '<div class="alert bad" id="cErrBox">' + esc(e.message) + '</div>'; $('.dlg').scrollTop = 0; }
        finally { busy(btn, false); }
      };
    });
  }

  // ---------- mensagens do WhatsApp (identidade da loja) ----------
  function itensTxt(o) { return o.itens.map(function (i) { return '• ' + qtyLabel(i.qty, i.unit) + ' ' + i.name + ' — ' + brl(i.line_cents); }).join('\n'); }
  function pagTxt(o) {
    var s = PAG[o.pagamento][0];
    if (o.pagamento === 'dinheiro') s += o.troco_para_cents ? ' — troco para ' + brl(o.troco_para_cents) + ' (levar ' + brl(o.troco_para_cents - o.total_cents) + ' de troco)' : ' — sem troco';
    if (o.pago) s += ' ✅ já pago';
    if (o.pagamento === 'pix' && !o.pago && S.cfg.chave_pix) s += '\nChave Pix: ' + S.cfg.chave_pix;
    return s;
  }
  function entregaTxt(o) {
    if (o.modo === 'retirada') return '*Retirada na loja:* ' + S.cfg.loja_endereco + '\n📍 ' + storeMaps();
    var s = '*Entrega:* ' + addrLine(o) + (o.complemento ? ' (' + o.complemento + ')' : '') + (o.referencia ? '\nReferência: ' + o.referencia : '');
    if (o.lat != null) s += '\n📍 Localização: ' + mapsUrl(o);
    return s;
  }
  function msgFor(o, kind) {
    var L = S.cfg.loja_nome, nome = first(o.cliente_nome), oq = o.tipo === 'encomenda' ? 'encomenda' : 'pedido', art = o.tipo === 'encomenda' ? 'Sua' : 'Seu';
    var sig = '\n\n🍃 *' + L + '*\n📍 ' + S.cfg.loja_endereco + '\n📞 WhatsApp ' + fmtPhone(S.cfg.loja_whatsapp);
    var ag = o.agendado_para ? '\n*' + (o.modo === 'entrega' ? 'Entrega' : 'Retirada') + ' combinada:* ' + fdt(o.agendado_para, { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    var resumo = '*Itens*\n' + itensTxt(o) + '\n' + (o.taxa_entrega_cents ? 'Subtotal: ' + brl(o.subtotal_cents) + '\nTaxa de entrega: ' + brl(o.taxa_entrega_cents) + '\n' : '') + '*Total: ' + brl(o.total_cents) + '*\n\n*Pagamento:* ' + pagTxt(o) + '\n' + entregaTxt(o) + ag + (o.obs ? '\nObs.: ' + o.obs : '');
    if (kind === 'confirmacao') return 'Olá, ' + nome + '! 🍅🥬\n' + art + ' ' + oq + ' nº *' + o.id + '* no *' + L + '* está anotad' + (o.tipo === 'encomenda' ? 'a' : 'o') + '.\n\n' + resumo + '\n\nSe precisar mudar alguma coisa é só responder aqui. Obrigado pela preferência!' + sig;
    if (kind === 'saiu') return 'Olá, ' + nome + '! 🚚 ' + art + ' ' + oq + ' nº *' + o.id + '* saiu para entrega.\n\n*Total: ' + brl(o.total_cents) + '*\n*Pagamento:* ' + pagTxt(o) + '\n' + entregaTxt(o) + sig;
    if (kind === 'pronto') return 'Olá, ' + nome + '! ✅ ' + art + ' ' + oq + ' nº *' + o.id + '* está pront' + (o.tipo === 'encomenda' ? 'a' : 'o') + ' para retirada.\n\n*Total: ' + brl(o.total_cents) + '*\n*Pagamento:* ' + pagTxt(o) + '\n📍 ' + S.cfg.loja_endereco + '\n' + storeMaps() + (S.cfg.horario ? '\n🕗 ' + S.cfg.horario : '') + sig;
    if (kind === 'entregue') return 'Olá, ' + nome + '! ' + art + ' ' + oq + ' nº *' + o.id + '* foi entregue. 💚\nObrigado por comprar no *' + L + '*! Quando quiser, é só pedir por aqui.' + sig;
    if (kind === 'loja') return '🧺 *' + (o.tipo === 'encomenda' ? 'Encomenda' : 'Pedido') + ' nº ' + o.id + '* — ' + L + '\n*Cliente:* ' + o.cliente_nome + ' · ' + fmtPhone(o.phone) + '\n\n' + resumo;
    return '';
  }
  function storeOrderTemplate() {
    return 'Olá, ' + S.cfg.loja_nome + '! Quero fazer um pedido 🧺\n\n*Nome:*\n*Endereço (rua, número, bairro):*\n*Ponto de referência:*\n*Itens:*\n- \n*Entrega ou retirada na loja:*\n*Pagamento (Pix, dinheiro ou cartão):*\n*Se for dinheiro, troco para quanto:*';
  }

  // ---------- detalhe do pedido ----------
  async function vPedido(id) {
    main.innerHTML = '<p class="muted">Carregando…</p>';
    await loadBase();
    var o = (await SB.get('v_pd_pedidos?select=*&id=eq.' + Number(id)))[0];
    if (!o) { main.innerHTML = '<div class="empty"><h3>Pedido não encontrado</h3><a class="btn" href="#/pedidos">Voltar</a></div>'; return; }
    var just = sessionStorage.getItem('pedidos.justSaved') === String(o.id); sessionStorage.removeItem('pedidos.justSaved');
    var fl = flow(o), ci = fl.indexOf(o.status), next = !FINAL[o.status] && ci >= 0 && ci < fl.length - 2 ? fl[ci + 1] : null;
    var kinds = [['confirmacao', 'Confirmação do pedido'], [o.modo === 'entrega' ? 'saiu' : 'pronto', o.modo === 'entrega' ? 'Saiu para entrega' : 'Pronto para retirada'], ['entregue', 'Agradecimento (entregue)'], ['loja', 'Resumo para a loja/entregador']];
    var defKind = o.status === 'saiu_entrega' ? 'saiu' : o.status === 'pronto_retirada' ? 'pronto' : o.status === 'entregue' ? 'entregue' : 'confirmacao';
    main.innerHTML = '<div class="sec-head"><div><div class="eyebrow">#' + o.id + ' · criado ' + esc(fdt(o.created_at)) + (o.created_by_name ? ' por ' + esc(o.created_by_name) : '') + '</div><h1>' + esc(o.cliente_nome) + '</h1><div class="row" style="margin-top:6px">' + tbadge(o.tipo) + badge(o.status) + (o.sale_number ? '<span class="badge st-entregue">Venda nº ' + o.sale_number + ' no caixa</span>' : '') + (isLate(o) ? '<span class="badge st-cancelado">Atrasada</span>' : '') + '</div></div><a class="btn ghost" href="#/pedidos">Voltar</a></div>' +
      (o.status === 'cancelado' ? '<div class="alert bad" style="margin-bottom:14px">Cancelado' + (o.cancel_motivo ? ': ' + esc(o.cancel_motivo) : '') + '</div>' : '<div class="steps" style="margin-bottom:16px">' + fl.map(function (s, i) { return '<div class="step ' + (i < ci ? 'done' : i === ci ? 'cur' : '') + '">' + ST[s] + '</div>'; }).join('') + '</div>') +
      '<div class="det"><div class="stack">' +
      '<section class="panel"><h3>Itens</h3><div class="items">' + o.itens.map(function (i) { return '<div class="item ro"><div class="ph">' + ph(i.name, i.icon) + '</div><div class="nm">' + esc(i.name) + '<small>' + qtyLabel(i.qty, i.unit) + ' × ' + brl(i.unit_price_cents) + '</small></div><div class="ln">' + brl(i.line_cents) + '</div></div>'; }).join('') + '</div>' +
      '<div class="kv" style="margin-top:12px"><span>Subtotal</span><b>' + brl(o.subtotal_cents) + '</b>' + (o.modo === 'entrega' ? '<span>Taxa de entrega</span><b>' + brl(o.taxa_entrega_cents) + '</b>' : '') + '<hr><span>Total</span><b class="tot">' + brl(o.total_cents) + '</b><span>Pagamento</span><b style="font-family:var(--font)">' + esc(PAG[o.pagamento][0]) + (o.pago ? ' · pago' : '') + '</b>' + (o.troco_para_cents ? '<span>Troco para ' + brl(o.troco_para_cents) + '</span><b style="color:var(--green)">levar ' + brl(o.troco_para_cents - o.total_cents) + '</b>' : (o.pagamento === 'dinheiro' ? '<span>Troco</span><b>não precisa</b>' : '')) + '</div></section>' +
      '<section class="panel"><h3>' + (o.modo === 'entrega' ? '🚚 Entrega' : '🏪 Retirada na loja') + '</h3>' + (o.modo === 'entrega' ? '<p style="margin:0">' + esc(addrLine(o)) + (o.complemento ? '<br><span class="muted">' + esc(o.complemento) + '</span>' : '') + (o.referencia ? '<br><span class="faint">Ref.: ' + esc(o.referencia) + '</span>' : '') + '</p><p style="margin:8px 0 0"><a class="map-link" target="_blank" rel="noopener" href="' + mapsUrl(o) + '">' + (o.lat != null ? '📍 Abrir localização GPS no mapa' : '🗺️ Abrir endereço no mapa') + '</a></p>' : '<p style="margin:0">' + esc(S.cfg.loja_endereco) + '</p>') +
      (o.agendado_para ? '<p style="margin:10px 0 0"><b>📅 Combinado para:</b> ' + esc(fdt(o.agendado_para, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</p>' : '') +
      '<p style="margin:10px 0 0" class="small muted">Cliente: ' + esc(fmtPhone(o.phone)) + '</p>' + (o.obs ? '<div class="alert info" style="margin-top:10px">Obs.: ' + esc(o.obs) + '</div>' : '') + '</section>' +
      '<section class="panel"><h3>Histórico</h3><ul class="timeline">' + o.eventos.map(function (e) { return '<li style="--bc:var(--' + ({ cancelado: 'red', entregue: 'green', novo: 'blue' }[e.status] || 'leaf') + ')"><div><b>' + esc(ST[e.status] || e.status) + '</b>' + (e.nota ? ' — ' + esc(e.nota) : '') + '<div class="faint small">' + esc(fdt(e.at)) + (e.por ? ' · ' + esc(e.por) : '') + '</div></div></li>'; }).join('') + '</ul></section>' +
      '</div><div class="stack">' +
      '<section class="panel"><h3>Andamento</h3><div class="actions" id="acts"></div></section>' +
      '<section class="panel" id="waBox"><h3>' + ic('wa') + ' WhatsApp</h3>' + (just ? '<div class="alert ok" style="margin-bottom:10px">Pedido salvo! Se o cliente quiser, mande a confirmação.</div>' : '') + '<label class="field"><span class="label">Mensagem</span><select class="select" id="wk">' + kinds.map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === defKind ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></label><div class="wa-preview" id="wp" style="margin-top:10px"></div><div class="actions" style="margin-top:10px"><a class="btn wa" id="waC" target="_blank" rel="noopener">' + ic('wa') + 'Enviar ao cliente</a><a class="btn" id="waL" target="_blank" rel="noopener">Enviar para o WhatsApp da loja</a><button class="btn ghost sm" id="waCopy">Copiar texto</button></div></section>' +
      '</div></div>';
    var paintWa = function () { var k = $('#wk').value, t = msgFor(o, k); $('#wp').textContent = t; $('#waC').href = waLink(o.phone, t); $('#waL').href = waLink(S.cfg.loja_whatsapp, t); $('#waC').hidden = k === 'loja'; };
    $('#wk').onchange = paintWa; paintWa();
    $('#waCopy').onclick = function () { navigator.clipboard.writeText($('#wp').textContent).then(function () { toast('Mensagem copiada', 'ok'); }, function () { toast('Não deu para copiar', 'bad'); }); };
    var acts = $('#acts');
    if (FINAL[o.status]) {
      acts.innerHTML = o.status === 'entregue' && !o.sale_id ? '<p class="small muted" style="margin:0">Entregue sem venda registrada no caixa.</p><button class="btn leaf" id="aSale">Registrar venda no caixa</button>' : '<p class="small muted" style="margin:0">' + (o.status === 'entregue' ? 'Pedido concluído' + (o.sale_number ? ' · venda nº ' + o.sale_number + ' no caixa' : '') + '.' : 'Pedido cancelado.') + '</p>';
    } else {
      acts.innerHTML = (next ? '<button class="btn primary" data-st="' + next + '">Marcar: ' + ST[next] + '</button>' : '') +
        '<button class="btn leaf" id="aSale">✔ Entregue + registrar venda no caixa</button><button class="btn sm" data-st="entregue">Entregue sem registrar venda</button>' +
        '<label class="field"><span class="label">Ou mudar para</span><select class="select" id="aSel"><option value="">—</option>' + fl.filter(function (s) { return s !== o.status && s !== 'entregue'; }).map(function (s) { return '<option value="' + s + '">' + ST[s] + '</option>'; }).join('') + '</select></label>' +
        '<div class="row"><a class="btn sm grow" href="#/editar/' + o.id + '">Editar pedido</a><button class="btn sm danger grow" id="aCancel">Cancelar</button></div>';
    }
    var setSt = async function (st, nota, pin, btn) {
      busy(btn, true);
      try { await SB.rpc('pd_pedido_status', { p_token: SB.opToken(), p_id: o.id, p_status: st, p_nota: nota || '', p_manager_pin: pin || null }); toast(ST[st] + ' ✓ — avise o cliente no WhatsApp', 'ok'); if (dlg.open) dlg.close(); loadOrders().catch(function () { }); route(); }
      catch (e) { toast(e.message, 'bad'); if (dlg.open && $('#dErr')) $('#dErr').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; }
      finally { busy(btn, false); }
    };
    $$('[data-st]', acts).forEach(function (b) { b.onclick = function () { if (b.dataset.st === 'entregue' && !confirm('Marcar como entregue SEM registrar a venda no caixa? (o estoque não baixa)')) return; setSt(b.dataset.st, '', null, b); }; });
    if ($('#aSel')) $('#aSel').onchange = function () { if (this.value) setSt(this.value, 'mudança manual', null, null); };
    if ($('#aCancel')) $('#aCancel').onclick = function () {
      var me = SB.me() || {};
      openDialog('<h2>Cancelar pedido #' + o.id + '</h2><label class="field"><span class="label">Motivo</span><input class="input" id="cm" placeholder="Ex.: cliente desistiu"></label>' + (me.role === 'operador' ? '<label class="field"><span class="label">PIN do gerente</span><input class="input" id="cp" type="password" inputmode="numeric" maxlength="4"></label>' : '') + '<div id="dErr"></div><div class="foot"><button class="btn ghost" data-close>Voltar</button><button class="btn danger" id="cOk">Cancelar pedido</button></div>', function () {
        $('#cOk').onclick = function () { setSt('cancelado', $('#cm').value, $('#cp') ? $('#cp').value : null, this); };
      });
    };
    if ($('#aSale')) $('#aSale').onclick = async function () {
      var ses = [];
      try { ses = await SB.get('v_cash_sessions?select=id,terminal,opened_by_name,opened_at&status=eq.ABERTO&order=opened_at.desc'); } catch (e) { }
      var troco = o.troco_para_cents ? '<div class="alert info">Dinheiro: recebe ' + brl(o.troco_para_cents) + ' e dá ' + brl(o.troco_para_cents - o.total_cents) + ' de troco.</div>' : '';
      openDialog('<h2>Entregue + venda no caixa</h2><p class="muted small" style="margin:0">Vira uma venda de verdade no Folha Caixa: número de venda, baixa no estoque, entra no caixa aberto' + (o.pagamento === 'fiado' ? ', vai para a caderneta do fiado' : '') + '. Aparece também na tela Encomendas do caixa como concluída.</p>' +
        '<div class="kv"><span>Total</span><b class="tot">' + brl(o.total_cents) + '</b><span>Pagamento</span><b style="font-family:var(--font)">' + esc(PAG[o.pagamento][0]) + '</b></div>' + troco +
        (ses.length ? '<label class="field"><span class="label">Caixa aberto (onde a venda entra)</span><select class="select" id="term">' + ses.map(function (s) { return '<option value="' + esc(s.terminal) + '">' + esc(s.terminal) + ' · aberto por ' + esc(s.opened_by_name) + ' ' + esc(fdt(s.opened_at)) + '</option>'; }).join('') + '</select></label>' : '<div class="alert bad">Nenhum caixa aberto agora. Abra o caixa no Folha Caixa e tente de novo (ou marque como entregue sem venda).</div>') +
        '<div id="dErr"></div><div class="foot"><button class="btn ghost" data-close>Voltar</button><button class="btn leaf" id="sOk"' + (ses.length ? '' : ' disabled') + '>Confirmar entrega e venda</button></div>', function () {
        $('#sOk').onclick = async function () {
          var b = this; busy(b, true);
          try { var r = await SB.rpc('pd_pedido_registrar_venda', { p_token: SB.opToken(), p_terminal: $('#term').value, p_id: o.id }); dlg.close(); toast('Venda nº ' + r.sale_number + ' registrada no caixa' + (r.change_cents ? ' · troco ' + brl(r.change_cents) : ''), 'ok'); loadOrders().catch(function () { }); route(); }
          catch (e) { $('#dErr').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; }
          finally { busy(b, false); }
        };
      });
    };
  }

  // ---------- agenda de encomendas ----------
  async function vAgenda() {
    main.innerHTML = '<div class="sec-head"><div><div class="eyebrow">Encomendas</div><h1>Agenda</h1><p>Encomendas abertas por dia combinado. Atrasadas ficam em vermelho.</p></div><a class="btn primary" href="#/novo" id="agNew">' + ic('plus') + 'Nova encomenda</a></div><div id="ag"><p class="muted">Carregando…</p></div>';
    $('#agNew').onclick = function () { S.draft = newDraft(); S.draft.tipo = 'encomenda'; saveDraft(); };
    await Promise.all([loadBase(), loadOrders()]);
    var L = S.orders.filter(function (o) { return o.tipo === 'encomenda' && !FINAL[o.status] && o.agendado_para; }).sort(function (a, b) { return new Date(a.agendado_para) - new Date(b.agendado_para); });
    var groups = {}; L.forEach(function (o) { var k = dayKey(o.agendado_para); (groups[k] = groups[k] || []).push(o); });
    var T = todayKey();
    $('#ag').innerHTML = L.length ? Object.keys(groups).map(function (k) { var o0 = groups[k][0]; return '<div class="day"><h3>' + (k === T ? 'Hoje · ' : k < T ? 'Atrasadas · ' : '') + esc(fdt(o0.agendado_para, { weekday: 'long', day: '2-digit', month: 'long' })) + ' <span class="faint">(' + groups[k].length + ')</span></h3><div class="orders">' + groups[k].map(ocard).join('') + '</div></div>'; }).join('') : '<div class="empty"><div style="font-size:40px">📅</div><h3>Nenhuma encomenda aberta</h3><p>Use “Nova encomenda” para agendar.</p></div>';
  }

  // ---------- clientes ----------
  async function vClientes() {
    main.innerHTML = '<div class="sec-head"><div><div class="eyebrow">Cadastro pelo telefone</div><h1>Clientes</h1><p>Endereço completo é obrigatório. Localização GPS é opcional.</p></div><button class="btn primary" id="cNew">' + ic('plus') + 'Novo cliente</button></div><div class="toolbar"><label class="search">' + ic('search') + '<input class="input" id="cq" type="search" placeholder="Nome, telefone ou bairro" aria-label="Buscar clientes"></label></div><div id="cl"><p class="muted">Carregando…</p></div>';
    await Promise.all([loadBase(), loadOrders()]);
    var all = await SB.get('pd_clientes?select=*&order=name');
    var cnt = {}; S.orders.forEach(function (o) { cnt[o.cliente_id] = (cnt[o.cliente_id] || 0) + 1; });
    var paint = function () {
      var t = $('#cq').value.trim().toLowerCase(), td = digits(t);
      var L = all.filter(function (c) { return !t || c.name.toLowerCase().indexOf(t) >= 0 || (td.length >= 3 && c.phone.indexOf(td) >= 0) || c.bairro.toLowerCase().indexOf(t) >= 0; });
      $('#cl').innerHTML = L.length ? '<div class="panel" style="padding:6px 12px"><table class="table"><thead><tr><th>Cliente</th><th>Endereço</th><th>Pedidos</th><th></th></tr></thead><tbody>' + L.map(function (c) { return '<tr data-id="' + c.id + '"><td><b>' + esc(c.name) + '</b><div class="small muted">' + esc(fmtPhone(c.phone)) + '</div></td><td class="small">' + esc(addrLine(c)) + (c.complemento ? ' · ' + esc(c.complemento) : '') + (c.lat != null ? ' <a class="map-link" target="_blank" rel="noopener" href="' + mapsUrl(c) + '" aria-label="Localização">📍</a>' : '') + '</td><td class="small">' + (cnt[c.id] || 0) + ' pedido(s)</td><td class="right"><div class="row" style="justify-content:flex-end;gap:6px"><button class="btn sm" data-ed>Editar</button><button class="btn sm primary" data-np>Novo pedido</button><a class="btn sm wa" target="_blank" rel="noopener" href="' + waLink(c.phone, 'Olá, ' + first(c.name) + '! Aqui é do ' + S.cfg.loja_nome + ' 🍃') + '" aria-label="WhatsApp de ' + esc(c.name) + '">' + ic('wa') + '</a></div></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty"><h3>Nenhum cliente</h3><p>Cadastre pelo botão Novo cliente ou durante o pedido.</p></div>';
      $$('#cl tr[data-id]').forEach(function (tr) {
        var c = all.find(function (x) { return x.id === Number(tr.dataset.id); });
        $('[data-ed]', tr).onclick = function () { clienteDialog(c, function (nc) { Object.assign(c, nc); paint(); }); };
        $('[data-np]', tr).onclick = function () { S.draft = newDraft(); S.draft.cliente = c; saveDraft(); location.hash = '#/novo'; };
      });
    };
    $('#cq').oninput = paint; paint();
    $('#cNew').onclick = function () { clienteDialog({}, function (nc) { all.push(nc); all.sort(function (a, b) { return a.name.localeCompare(b.name); }); paint(); }); };
  }

  // ---------- loja / sobre / contato ----------
  async function vLoja() {
    await loadBase(true);
    var me = SB.me() || {}, canEdit = me.role === 'admin' || me.role === 'gerente', c = S.cfg;
    var link = waLink(c.loja_whatsapp, storeOrderTemplate());
    main.innerHTML = '<div class="sec-head"><div><div class="eyebrow">Sobre e contato</div><h1>' + esc(c.loja_nome) + '</h1></div></div>' +
      '<div class="det"><div class="stack"><section class="panel"><div class="row" style="gap:16px;align-items:flex-start"><img src="icons/logo-frutos-da-roca.png" alt="Logo Frutos da Roça" style="width:110px;height:110px;border-radius:22px"><div class="grow"><h2 style="margin:0 0 6px">' + esc(c.loja_nome) + '</h2><p style="margin:0">Frutas e verduras fresquinhas todo dia · 🚚 fazemos entregas</p><p style="margin:8px 0 0">📍 <b>' + esc(c.loja_endereco) + '</b> · <a class="map-link" target="_blank" rel="noopener" href="' + storeMaps() + '">ver no mapa</a></p><p style="margin:6px 0 0">📞 WhatsApp <b>' + esc(fmtPhone(c.loja_whatsapp)) + '</b>' + (c.horario ? ' · 🕗 ' + esc(c.horario) : '') + '</p></div></div></section>' +
      '<section class="panel"><h3>' + ic('wa') + ' Mensagem pronta para o cliente pedir</h3><p class="small muted" style="margin:0 0 8px">Mande este link no status, Instagram ou para quem pedir: abre o WhatsApp da loja com a mensagem de pedido já preenchida.</p><div class="wa-preview" id="tpl">' + esc(storeOrderTemplate()) + '</div><div class="row" style="margin-top:10px"><a class="btn wa" id="tplLink" target="_blank" rel="noopener" href="' + link + '">Abrir no WhatsApp</a><button class="btn" id="cpL">Copiar link</button>' + (navigator.share ? '<button class="btn" id="shL">Compartilhar</button>' : '') + '</div></section>' +
      '<section class="panel"><h3>Configurações dos pedidos</h3>' + (canEdit ? '' : '<p class="small muted">Só gerente ou admin altera.</p>') + '<form id="lf" class="stack"><div class="grid2"><label class="field"><span class="label">Nome da loja</span><input class="input" name="loja_nome" value="' + esc(c.loja_nome) + '"></label><label class="field"><span class="label">WhatsApp da loja</span><input class="input" name="loja_whatsapp" inputmode="tel" value="' + esc(fmtPhone(c.loja_whatsapp)) + '"></label></div><label class="field"><span class="label">Endereço da loja (retirada)</span><input class="input" name="loja_endereco" value="' + esc(c.loja_endereco) + '"></label><div class="grid3"><label class="field"><span class="label">Taxa de entrega padrão</span><input class="input" name="taxa" inputmode="decimal" value="' + moneyInput(c.taxa_entrega_cents) + '"></label><label class="field"><span class="label">Chave Pix (vai na mensagem)</span><input class="input" name="chave_pix" value="' + esc(c.chave_pix) + '"></label><label class="field"><span class="label">Horário</span><input class="input" name="horario" placeholder="Seg–Sáb 7h–19h" value="' + esc(c.horario) + '"></label></div><div id="lErr"></div>' + (canEdit ? '<button class="btn primary" id="lOk" style="align-self:flex-start">Salvar</button>' : '') + '</form></section></div>' +
      '<div class="stack"><section class="panel"><h3>Minha conta</h3><p style="margin:0">' + esc(me.name || '') + ' · <span class="muted">' + esc(me.role || '') + '</span></p><p class="small muted">Mesmo login do Folha Caixa. Aparelho: ' + esc(SB.terminal()) + '</p><button class="btn danger" id="out">Sair</button></section>' +
      '<section class="panel"><h3>Sobre o app</h3><p class="small muted" style="margin:0">Pedidos v' + VERSION + ' · ligado ao banco do Folha Caixa (produtos, preços, promoções, caixa, estoque e fiado). Fotos dos produtos de bancos livres — <a class="map-link" target="_blank" rel="noopener" href="CREDITOS-IMAGENS.md">créditos</a>.</p></section></div></div>';
    if (!canEdit) $$('#lf .input').forEach(function (i) { i.disabled = true; });
    $('#cpL').onclick = function () { navigator.clipboard.writeText(link).then(function () { toast('Link copiado', 'ok'); }, function () { toast('Não deu para copiar', 'bad'); }); };
    if ($('#shL')) $('#shL').onclick = function () { navigator.share({ title: c.loja_nome, text: 'Faça seu pedido no ' + c.loja_nome + ' pelo WhatsApp:', url: link }).catch(function () { }); };
    $('#out').onclick = async function () { await SB.signOut(); location.hash = '#/login'; route(); };
    if ($('#lOk')) $('#lf').onsubmit = async function (ev) {
      ev.preventDefault(); var f = this, b = $('#lOk'); busy(b, true);
      try { S.cfg = await SB.rpc('pd_config_salvar', { p_token: SB.opToken(), p_data: { loja_nome: f.loja_nome.value, loja_whatsapp: normPhone(f.loja_whatsapp.value), loja_endereco: f.loja_endereco.value, taxa_entrega_cents: parseMoney(f.taxa.value) || 0, chave_pix: f.chave_pix.value, horario: f.horario.value } }); S.loadedAt = 0; toast('Configurações salvas', 'ok'); paintStore(); vLoja(); }
      catch (e) { $('#lErr').innerHTML = '<div class="alert bad">' + esc(e.message) + '</div>'; }
      finally { busy(b, false); }
    };
  }

  // ---------- PWA ----------
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = function () { if (deferred) { deferred.prompt(); deferred = null; $('#installBtn').hidden = true; } };
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () { });
  paintStore();
  window.PD = { msgFor: msgFor, waLink: waLink, S: S, version: VERSION };
  route();
})();
