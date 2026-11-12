import fs from 'node:fs';
const ANON = fs.readFileSync('/workspace/pedidos-local/keys.env', 'utf8').match(/^ANON=(.*)$/m)[1].trim();
const U = 'http://127.0.0.1:54340';
export async function login(u, p = 'senha12345', term = 'CAIXA-BALCAO') {
  const r = await (await fetch(U + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email: u + '@folhacaixa.app', password: p }) })).json();
  const jwt = r.access_token;
  const call = async (fn, args) => { const x = await fetch(U + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + jwt, 'content-type': 'application/json' }, body: JSON.stringify(args) }); const t = await x.text(); if (!x.ok) throw new Error(t); return JSON.parse(t || 'null'); };
  const get = async (q) => (await fetch(U + '/rest/v1/' + q, { headers: { apikey: ANON, authorization: 'Bearer ' + jwt } })).json();
  const op = await call('self_login', { p_terminal: term });
  return { jwt, tok: op.token, call, get, raw: (q, h = {}) => fetch(U + '/rest/v1/' + q, { headers: { apikey: ANON, ...h } }) };
}
