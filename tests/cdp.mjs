// Helper mínimo de Chrome DevTools Protocol para os testes da Prancheta
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
export async function open({ port = 9340, dir = '/tmp/pr-cdp', width = 390, height = 844, mobile = true } = {}) {
  try { execSync('pkill -f "remote-debugging-port=' + port + ' "'); } catch { }
  await new Promise(r => setTimeout(r, 300));
  fs.rmSync(dir, { recursive: true, force: true });
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, 'about:blank'], { stdio: 'ignore', detached: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let t; for (let i = 0; i < 60; i++) { try { t = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (t.find(x => x.type === 'page')) break; } catch { } await sleep(200); }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); const errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' && !/InjectContentScripts/.test(JSON.stringify(m.params.args))) errors.push('console: ' + JSON.stringify(m.params.args.map(a => a.value ?? a.description)));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon|^chrome-extension:/.test(m.params.entry.url || '') && !(/status of 404/.test(m.params.entry.text) && /:8767\//.test(m.params.entry.url || ''))) errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || '')); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result.exceptionDetails) throw new Error(x.slice(0, 100) + ' => ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { } await sleep(120); } return false; };
  const shot = async (f, full = false) => { await sleep(450); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }); fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await send('Browser.grantPermissions', { origin: 'http://127.0.0.1:8796', permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  const close = () => { try { ws.close(); } catch { } try { process.kill(-chrome.pid, 'SIGKILL'); } catch { } try { execSync('pkill -f "remote-debugging-port=' + port + ' "'); } catch { } };
  return { send, ev, waitFor, shot, sleep, errors, close };
}
