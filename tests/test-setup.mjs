// Testa setup.html: copiar (texto exato do .sql), teste de conexão (pronto / não ativado), screenshot de celular
// uso: node tests/test-setup.mjs [baseURL] [--live]
import fs from 'node:fs'; import http from 'node:http'; import { open } from './cdp.mjs';
const BASE = process.argv[2] || 'http://127.0.0.1:8796/';
const LIVE = process.argv.includes('--live');
const SQL = fs.readFileSync(new URL('../supabase/2026-11-12_pedidos_v1.sql', import.meta.url), 'utf8');
let ok = 0, fail = 0; const t = (n, c) => { if (c) { ok++; console.log('✓', n); } else { fail++; console.log('✗', n); } };
// servidor falso que responde como um banco SEM as tabelas
const fake = http.createServer((q, r) => { r.writeHead(q.method === 'OPTIONS' ? 204 : 404, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
  r.end(q.method === 'OPTIONS' ? '' : JSON.stringify(/rpc/.test(q.url) ? { code: 'PGRST202', message: 'Could not find the function' } : { code: 'PGRST205', message: "Could not find the table 'public.pd_pedidos' in the schema cache" })); }).listen(8797);
const b = await open({ port: 9346, dir: '/tmp/setup-cdp' });
await b.send('Browser.grantPermissions', { origin: new URL(BASE).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
try {
  await b.send('Page.navigate', { url: BASE + 'setup.html' });
  t('código carregado', await b.waitFor(`!document.getElementById('copiar').disabled && document.getElementById('sql').value.length > 1000`, 15000));
  if (!LIVE) await b.shot('shots/setup.png');
  t('textarea = arquivo exato', (await b.ev(`document.getElementById('sql').value`)) === SQL);
  await b.ev(`navigator.clipboard.writeText('lixo')`);
  await b.ev(`document.getElementById('copiar').click()`);
  t('mostra Copiado!', await b.waitFor(`/Copiado!/.test(document.getElementById('copiar').textContent)`));
  const clip = await b.ev(`navigator.clipboard.readText()`);
  t(`área de transferência = SQL exato (${clip.length}/${SQL.length} caracteres)`, clip === SQL);
  // fallback (sem navigator.clipboard), como em navegadores antigos
  await b.ev(`navigator.clipboard.writeText('lixo2')`);
  const fb = await b.ev(`(function(){ var c = navigator.clipboard; Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
     document.getElementById('copiar').classList.remove('ok'); document.getElementById('copiar').click();
     Object.defineProperty(navigator, 'clipboard', { value: c, configurable: true }); return /Copiado!/.test(document.getElementById('copiar').textContent); })()`);
  t('fallback (execCommand) mostra Copiado!', fb);
  const clip2 = await b.ev(`navigator.clipboard.readText()`);
  t('fallback copia o SQL exato', clip2 === SQL);
  t('link do Supabase em nova aba', await b.ev(`(function(a){return a.href==='https://supabase.com/dashboard/project/cprtigvovwbmigxbosac/sql/new' && a.target==='_blank'})(document.getElementById('abrir'))`));
  if (!LIVE) {
    await b.ev(`document.getElementById('testar').click()`);
    t('banco local com pedidos → Banco pronto', await b.waitFor(`document.body.dataset.teste === 'pronto'`, 10000));
    await b.ev(`document.getElementById('status').scrollIntoView({block:'center'})`); await b.shot('shots/setup-pronto.png');
    await b.ev(`PD_CONFIG.url = 'http://127.0.0.1:8797'; document.getElementById('testar').click()`);
    t('banco sem pedidos → Ainda não ativado', await b.waitFor(`document.body.dataset.teste === 'falta' && /Ainda não ativado/.test(document.getElementById('status').textContent)`, 10000));
    await b.shot('shots/setup-nao-ativado.png');
  } else {
    await b.shot('shots/setup-live.png');
  }
  t('sem erros JS', b.errors.filter(e => !/Failed to load resource/.test(e)).length === 0 || (console.log(b.errors), false));
} finally { b.close(); fake.close(); }
console.log(`\n${ok} ok, ${fail} falhas`); process.exit(fail ? 1 : 0);
