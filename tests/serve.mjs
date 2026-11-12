// servidor de teste: serve /workspace/pedidos, trocando assets/config.js para o Supabase local
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = '/workspace/pedidos';
const ANON = fs.readFileSync('/workspace/pedidos-local/keys.env', 'utf8').match(/^ANON=(.*)$/m)[1].trim();
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json' };
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  if (p === '/assets/config.js') { r.writeHead(200, { 'content-type': T['.js'] }); return r.end(`window.PD_CONFIG={url:'http://127.0.0.1:54340',key:'${ANON}',dominio:'folhacaixa.app'};`); }
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('404'); }
  r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(r);
}).listen(8796, '127.0.0.1', () => console.log('serve :8796'));
