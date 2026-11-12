// Backup do banco do Folha Caixa (primário) para um projeto Supabase reserva.
// O primário é SÓ LIDO (apenas SELECT). Tudo que é escrito vai para o reserva.
//
// Uso:
//   node backup/backup.mjs schema   # cria/atualiza o schema no reserva (SQL do Folha Caixa + pedidos)
//   node backup/backup.mjs data     # apaga os dados do reserva e copia tudo do primário
//   node backup/backup.mjs verify   # compara a contagem de linhas primário x reserva
//   node backup/backup.mjs all      # schema + data + verify
//
// Conexão (escolha uma por lado; nada de token no código):
//   Management API:  PRIMARY_REF + PRIMARY_TOKEN   /   BACKUP_REF + BACKUP_TOKEN   (sbp_…)
//   Postgres direto: PRIMARY_DB_URL                /   BACKUP_DB_URL              (precisa do pacote "pg")
// Opcional: FOLHA_CAIXA_DIR (padrão ../folha-caixa), SKIP_TABLES (padrão op_sessions), CHUNK_ROWS (padrão 1000)
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const FC = path.resolve(process.env.FOLHA_CAIXA_DIR || path.join(ROOT, '..', 'folha-caixa'));
const PRIMARY_DEFAULT_REF = 'cprtigvovwbmigxbosac';
const SKIP = new Set((process.env.SKIP_TABLES ?? 'op_sessions').split(',').map((s) => s.trim()).filter(Boolean));
const CHUNK = Number(process.env.CHUNK_ROWS || 1000);

function die(msg) { console.error('ERRO: ' + msg); process.exit(1); }

async function makeRunner(side) {
  const url = process.env[`${side}_DB_URL`];
  if (url) {
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    await c.connect();
    const run = async (q) => { const r = await c.query(q); const last = Array.isArray(r) ? r[r.length - 1] : r; return last.rows; };
    return { id: url.replace(/:\/\/[^@]*@/, '://***@'), ref: (url.match(/[a-z]{20}/) || [''])[0], run, close: () => c.end() };
  }
  const ref = process.env[`${side}_REF`] || (side === 'PRIMARY' ? PRIMARY_DEFAULT_REF : '');
  const token = process.env[`${side}_TOKEN`];
  if (!ref || !token) die(`defina ${side}_REF e ${side}_TOKEN (ou ${side}_DB_URL).`);
  const run = async (query) => {
    for (let tent = 1; ; tent++) {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
      });
      const txt = await r.text();
      if (r.ok) return txt ? JSON.parse(txt) : [];
      if ((r.status === 429 || r.status >= 500) && tent < 4) { await new Promise((s) => setTimeout(s, 1500 * tent)); continue; }
      throw new Error(`${side} ${r.status}: ${txt.slice(0, 1500)}`);
    }
  };
  return { id: ref, ref, run, close: async () => {} };
}

// O primário só aceita SELECT/WITH — trava contra escrita acidental.
function readOnly(db) {
  return { ...db, run: (q) => {
    const s = q.trim().replace(/;\s*$/, '');
    if (!/^(select|with)\b/i.test(s) || s.includes(';')) throw new Error('consulta bloqueada no primário (só SELECT): ' + s.slice(0, 80));
    return db.run(s);
  } };
}

const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const ql = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function dollar(body) { let tag = 'bk'; while (body.includes(`$${tag}$`)) tag += 'x'; return `$${tag}$${body}$${tag}$`; }

function schemaFiles() {
  const sqlDir = path.join(FC, 'supabase', 'sql');
  if (!fs.existsSync(sqlDir)) die(`não achei ${sqlDir} (defina FOLHA_CAIXA_DIR).`);
  const base = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
  const grants = base.filter((f) => f.startsWith('99_'));
  // supabase/sql já contém o schema completo (as migrations antigas foram incorporadas nele)
  const files = [
    ...base.filter((f) => !f.startsWith('99_')).map((f) => path.join(sqlDir, f)),
    ...grants.map((f) => path.join(sqlDir, f)),
    // pedidos por último: o 99_grants do caixa revoga funções que não conhece
    ...fs.readdirSync(path.join(ROOT, 'supabase')).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(ROOT, 'supabase', f)),
  ];
  return files;
}

async function doSchema(bk) {
  for (const f of schemaFiles()) {
    process.stdout.write(`  schema ← ${path.relative(path.dirname(FC), f)} … `);
    await bk.run(fs.readFileSync(f, 'utf8'));
    console.log('ok');
  }
}

const TABLES_SQL = (schema) => `select coalesce(json_agg(json_build_object('t', c.relname,
   'cols', (select json_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''),
   'pk', (select json_agg(a.attname order by array_position(i.indkey::int2[], a.attnum)) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = c.oid and i.indisprimary),
   'deps', (select json_agg(distinct r.relname) from pg_constraint k join pg_class r on r.oid = k.confrelid where k.conrelid = c.oid and k.contype = 'f' and k.confrelid <> c.oid
              and r.relnamespace = c.relnamespace)
 ) order by c.relname), '[]') as j
 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${ql(schema)} and c.relkind = 'r'`;

async function tables(db, schema = 'public') { return (await db.run(TABLES_SQL(schema)))[0].j; }

function topo(list) {
  const by = new Map(list.map((t) => [t.t, t])); const out = []; const st = new Map();
  const visit = (n, trail) => {
    if (st.get(n) === 2) return; if (st.get(n) === 1) throw new Error('ciclo de FK: ' + [...trail, n].join(' → '));
    st.set(n, 1); for (const d of by.get(n)?.deps || []) if (by.has(d)) visit(d, [...trail, n]); st.set(n, 2); out.push(by.get(n));
  };
  for (const t of list) visit(t.t, []);
  return out;
}

async function counts(db, names) {
  if (!names.length) return {};
  const q = 'select json_build_object(' + names.map((t) => `${ql(t)}, (select count(*) from public.${qi(t)})`).join(', ') + ') as j';
  return (await db.run(q))[0].j;
}

async function doData(pr, bk) {
  const ptabs = await tables(pr); const btabs = await tables(bk);
  const bmap = new Map(btabs.map((t) => [t.t, t]));
  const missing = ptabs.filter((t) => !bmap.has(t.t) && !SKIP.has(t.t)).map((t) => t.t);
  if (missing.length) console.warn('  AVISO: tabelas do primário que não existem no reserva (rode "schema"): ' + missing.join(', '));
  const copy = topo(btabs.filter((t) => !SKIP.has(t.t) && ptabs.some((p) => p.t === t.t)));
  // Esvazia o reserva (só ele!) antes de copiar
  await bk.run('truncate table ' + btabs.map((t) => 'public.' + qi(t.t)).join(', ') + ' restart identity cascade');
  const result = {};
  // Logins (auth.users/identities) — para que os mesmos usuários e senhas funcionem no reserva
  let authOk = false;
  if (process.env.COPY_AUTH !== '0') {
    try {
      await bk.run('delete from auth.identities; delete from auth.users');
      const pa = await tables(pr, 'auth'); const ba = await tables(bk, 'auth');
      for (const t of ['users', 'identities']) {
        const pt = pa.find((x) => x.t === t); const bt = ba.find((x) => x.t === t);
        if (pt && bt) result['auth.' + t] = await copyTable(pr, bk, 'auth', pt, bt);
      }
      authOk = true;
    } catch (e) { console.warn('  AVISO: não deu para copiar auth.users (' + e.message.slice(0, 160) + '); users.auth_uid fica vazio no reserva.'); }
  }
  for (const bt of copy) {
    const pt = ptabs.find((p) => p.t === bt.t);
    result[bt.t] = await copyTable(pr, bk, 'public', pt, bt, !authOk && bt.t === 'users' ? { auth_uid: null } : null);
  }
  return result;
}

async function copyTable(pr, bk, schema, pt, bt, override) {
    const T = `${qi(schema)}.${qi(bt.t)}`;
    const cols = bt.cols.filter((c) => pt.cols.includes(c));
    const extra = pt.cols.filter((c) => !bt.cols.includes(c));
    if (extra.length) console.warn(`  AVISO: ${bt.t}: colunas só no primário, não copiadas: ${extra.join(', ')}`);
    const order = (pt.pk && pt.pk.length ? pt.pk : cols.slice(0, 1)).map(qi).join(', ');
    const colList = cols.map(qi).join(', ');
    const selList = cols.map((c) => (override && c in override ? 'null as ' + qi(c) : qi(c))).join(', ');
    let n = 0;
    for (let off = 0; ; off += CHUNK) {
      const rows = (await pr.run(`select coalesce(json_agg(x), '[]') as j from (select ${selList} from ${T} order by ${order} limit ${CHUNK} offset ${off}) x`))[0].j;
      if (!rows.length) break;
      await bk.run(`insert into ${T} (${colList}) select ${colList} from jsonb_populate_recordset(null::${T}, ${dollar(JSON.stringify(rows))}::jsonb)`);
      n += rows.length;
      if (rows.length < CHUNK) break;
    }
    console.log(`  dados ${(schema === 'public' ? bt.t : schema + '.' + bt.t).padEnd(22)} ${n}`);
    return n;
}

async function fixSequences(bk) {
  // Ajusta as sequências (ids serial) do reserva para continuar depois do maior id
  await bk.run(`do $$ declare r record; begin
    for r in select s.relname seq, t.relname tab, a.attname col from pg_class s
      join pg_depend d on d.objid = s.oid and d.deptype in ('a','i') join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid join pg_namespace n on n.oid = s.relnamespace
      where s.relkind = 'S' and n.nspname = 'public' loop
      execute format('select setval(%L, coalesce((select max(%I) from public.%I), 0) + 1, false)', 'public.' || r.seq, r.col, r.tab);
    end loop; end $$`);
}

async function doVerify(pr, bk) {
  const names = (await tables(pr)).map((t) => t.t).filter((t) => !SKIP.has(t));
  const bnames = new Set((await tables(bk)).map((t) => t.t));
  const a = await counts(pr, names); const b = await counts(bk, names.filter((t) => bnames.has(t)));
  let ok = true;
  console.log('  tabela                 primário  reserva');
  for (const t of names) { const same = String(a[t]) === String(b[t]); ok &&= same; console.log(`  ${t.padEnd(22)} ${String(a[t]).padStart(8)} ${String(b[t] ?? '—').padStart(8)}${same ? '' : '  ≠'}`); }
  console.log(ok ? '  OK: contagens iguais.' : '  ATENÇÃO: diferenças (o primário pode ter recebido vendas durante a cópia).');
  return ok;
}

const cmd = process.argv[2] || 'all';
if (!['schema', 'data', 'verify', 'all'].includes(cmd)) die('comando: schema | data | verify | all');
const prRaw = await makeRunner('PRIMARY');
const bk = await makeRunner('BACKUP');
if (bk.id === prRaw.id || (bk.ref && (bk.ref === prRaw.ref || bk.ref === PRIMARY_DEFAULT_REF))) die('o reserva não pode ser o projeto primário.');
const pr = readOnly(prRaw);
const t0 = Date.now();
console.log(`Primário: ${prRaw.id} (somente leitura)  →  Reserva: ${bk.id}`);
try {
  if (cmd === 'schema' || cmd === 'all') await doSchema(bk);
  if (cmd === 'data' || cmd === 'all') { await doData(pr, bk); await fixSequences(bk); }
  if (cmd === 'verify' || cmd === 'all') process.exitCode = (await doVerify(pr, bk)) ? 0 : 2;
  console.log(`Concluído em ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
} finally { await prRaw.close(); await bk.close(); }
