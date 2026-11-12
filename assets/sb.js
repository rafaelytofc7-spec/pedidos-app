/* Cliente mínimo do Supabase (Auth + PostgREST), sem dependências.
   Login = o mesmo usuário + senha do Folha Caixa (e-mail interno usuario@folhacaixa.app). */
(function () {
  'use strict';
  var C = window.PD_CONFIG;
  var KA = 'pedidos.auth', KT = 'pedidos.op';
  function ApiError(msg, code, status) { var e = new Error(msg); e.code = code || 'ERRO'; e.status = status || 0; return e; }
  function load() { try { return JSON.parse(localStorage.getItem(KA) || 'null'); } catch (e) { return null; } }
  function save(s) { if (s) localStorage.setItem(KA, JSON.stringify(s)); else localStorage.removeItem(KA); }
  function now() { return Math.floor(Date.now() / 1000); }
  async function http(path, opt) {
    var r;
    try { r = await fetch(C.url + path, opt); }
    catch (e) { window.dispatchEvent(new CustomEvent('pd:net', { detail: false })); throw ApiError('Sem internet. Confira a conexão e tente de novo.', 'SEM_INTERNET'); }
    window.dispatchEvent(new CustomEvent('pd:net', { detail: true }));
    var txt = await r.text(); var j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = txt; }
    if (!r.ok) {
      var msg = (j && (j.message || j.msg || j.error_description || j.error)) || ('Erro ' + r.status);
      var code = (j && j.hint && /^[A-Z_]+$/.test(j.hint)) ? j.hint : (j && j.code) || 'ERRO';
      if (code === '42501') { code = 'SEM_LOGIN'; msg = 'Sem permissão. Entre com usuário e senha.'; }
      if (r.status === 401 && code === 'ERRO') code = 'SEM_LOGIN';
      throw ApiError(msg, code, r.status);
    }
    return { data: j, headers: r.headers };
  }
  var refreshing = null;
  async function access() {
    var s = load();
    if (!s) throw ApiError('Entre com usuário e senha.', 'SEM_LOGIN');
    if (s.expires_at - 60 > now()) return s.access_token;
    if (!refreshing) refreshing = (async function () {
      try {
        var r = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: C.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
        var d = r.data; save({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || now() + d.expires_in, user: d.user });
        return d.access_token;
      } catch (e) { if (e.code !== 'SEM_INTERNET') { save(null); throw ApiError('Sua sessão expirou. Entre de novo.', 'SEM_LOGIN'); } throw e; }
      finally { refreshing = null; }
    })();
    return refreshing;
  }
  function hdr(tok, extra) { var h = { apikey: C.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }; for (var k in extra || {}) h[k] = extra[k]; return h; }
  var SB = {
    ApiError: ApiError,
    hasSession: function () { return !!load() && !!localStorage.getItem(KT); },
    opToken: function () { return localStorage.getItem(KT) || ''; },
    terminal: function () {
      var t = localStorage.getItem('pedidos.device');
      if (!t) { t = 'Pedidos-' + Math.random().toString(36).slice(2, 7).toUpperCase(); localStorage.setItem('pedidos.device', t); }
      return t;
    },
    signIn: async function (username, password) {
      var u = String(username || '').trim().toLowerCase();
      if (!u || !password) throw ApiError('Digite usuário e senha.', 'DADOS');
      var r;
      try { r = await http('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: C.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u + '@' + C.dominio, password: password }) }); }
      catch (e) { if (e.code === 'SEM_INTERNET') throw e; throw ApiError('Usuário ou senha incorretos.', 'LOGIN_ERRADO'); }
      var d = r.data; save({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || now() + d.expires_in, user: d.user });
      try {
        var op = await SB.rpc('self_login', { p_terminal: SB.terminal() }, true);
        localStorage.setItem(KT, op.token); localStorage.setItem('pedidos.me', JSON.stringify(op.user));
        return op.user;
      } catch (e) { save(null); throw e; }
    },
    me: function () { try { return JSON.parse(localStorage.getItem('pedidos.me') || 'null'); } catch (e) { return null; } },
    signOut: async function () {
      var t = SB.opToken();
      try { if (t) await SB.rpc('pin_logout', { p_token: t }, true); } catch (e) { }
      try { var tok = await access(); await http('/auth/v1/logout', { method: 'POST', headers: hdr(tok) }); } catch (e) { }
      save(null); localStorage.removeItem(KT); localStorage.removeItem('pedidos.me');
    },
    rpc: async function (fn, args, silent) {
      var tok = await access();
      try { return (await http('/rest/v1/rpc/' + fn, { method: 'POST', headers: hdr(tok), body: JSON.stringify(args || {}) })).data; }
      catch (e) { if (!silent && /SEM_LOGIN|SEM_PIN/.test(e.code)) window.dispatchEvent(new CustomEvent('pd:auth')); throw e; }
    },
    /** select na API: SB.get('v_products?select=*&active=eq.true') */
    get: async function (q) {
      var tok = await access();
      try { return (await http('/rest/v1/' + q, { headers: hdr(tok) })).data; }
      catch (e) { if (/SEM_LOGIN|SEM_PIN/.test(e.code)) window.dispatchEvent(new CustomEvent('pd:auth')); throw e; }
    }
  };
  window.SB = SB;
})();
