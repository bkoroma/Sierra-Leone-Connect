// Runs every test suite: node tests/run-all.mjs   (or: npm test, inside tests/)
// Starts a small static server for the browser suites unless one is already listening on port 8766.
import http from 'http'; import fs from 'fs'; import path from 'path'; import { spawnSync } from 'child_process';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', txt: 'text/plain' };
const server = http.createServer((req, res) => {
  let p = path.normalize(decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/') || p.endsWith(path.sep)) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[f.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.once('error', () => r()).listen(8766, '127.0.0.1', r));
fs.mkdirSync(ROOT + '/tests/.out/shots', { recursive: true });
const only = process.argv[2];
const suites = fs.readdirSync(ROOT + '/tests').filter(f => /^(unit|sql|e2e|a11y).*\.mjs$/.test(f) && (!only || f.includes(only))).sort((a, b) => 'usea'.indexOf(a[0]) - 'usea'.indexOf(b[0]) || a.localeCompare(b));
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', s)], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = (out.match(/\d+ passed, \d+ failed/g) || out.match(/TOTAL failing rule instances: \d+/g) || ['no summary']).pop();
  const bad = r.status !== 0 || /[1-9]\d* failed|instances: [1-9]/.test(summary);
  if (bad) { failed++; console.log(out.split('\n').filter(l => /^✗|Error/.test(l)).slice(0, 12).join('\n')); }
  console.log(`${bad ? '✗' : '✓'} ${s.padEnd(28)} ${summary}`);
}
server.close();
console.log(failed ? `\n${failed} suite(s) failed` : `\nAll ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
