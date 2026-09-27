// scripts/perf-check.js — formalize the WORKFLOW/BRIEF speed expectation.
// Measures, against a production server on a scratch DB:
//   1. first screen (document + JS bundle + login + first authenticated request) < 1s
//   2. org switch cost (token re-scope + refetch)
//   3. scaling: device/member list latency at 7 rows vs +300 rows (no-N+1 proof)
// Run: node scripts/perf-check.js   (needs dist/: run `npm run build` first)
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';

const PORT = 8133;
const DB = 'perf.db';
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, DATABASE_FILE: DB, PORT: String(PORT), NODE_ENV: 'production', JWT_SECRET: 'perf-secret' };

for (const s of ['', '-wal', '-shm']) if (existsSync(DB + s)) rmSync(DB + s);
spawnSync('node', ['scripts/load-db.js'], { cwd: process.cwd(), env, stdio: 'inherit' });

// +300 devices into Acme AFTER the baseline measurement, to prove list cost
// doesn't scale with rows (server keeps running; WAL allows concurrent write).
async function seedExtra(n = 300) {
  const { openDatabase } = await import('../server/db.js');
  const db = openDatabase(DB);
  const ins = db.prepare(`INSERT INTO devices (id,org_id,name,kind,online) VALUES (?,?,?,?,?)`);
  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) ins.run(`dev_perf_${String(i).padStart(3, '0')}`, 'org_acme', `perf-${i}`, 'linux', i % 2);
  });
  tx();
  const total = db.prepare(`SELECT count(*) n FROM devices WHERE org_id='org_acme'`).get().n;
  db.close();
  return total;
}

const server = spawn('node', ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => { server.stdout.on('data', (d) => { if (String(d).includes('RemoteOps on')) r(); }); setTimeout(r, 8000); });

const t = async (label, fn, iters = 5) => {
  const ts = [];
  let out;
  for (let i = 0; i < iters; i++) { const a = performance.now(); out = await fn(); ts.push(performance.now() - a); }
  ts.sort((x, y) => x - y);
  console.log(`${ts[0].toFixed(1)}ms min / ${ts[Math.floor(ts.length / 2)].toFixed(1)}ms med  ${label}`);
  return out;
};
const j = (r) => r.json();

const doc = await t('GET / (document)', () => fetch(`${BASE}/`).then((r) => r.text()));
const bundle = (doc.match(/src="(\/assets\/[^"]+)"/) || [])[1];
if (bundle) await t(`GET ${bundle} (251KB js)`, () => fetch(`${BASE}${bundle}`).then((r) => r.arrayBuffer()));
const login = await t('POST login (sam)', () => fetch(`${BASE}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sam@example.test', password: 'demo1234' }) }).then(j));
const H = { Authorization: `Bearer ${login.token}` };
await t('GET /auth/me (first auth req)', () => fetch(`${BASE}/v1/auth/me`, { headers: H }).then(j));
await t('GET devices A (5 rows, fixture)', () => fetch(`${BASE}/v1/orgs/org_acme/devices`, { headers: H }).then(j));
const total = await seedExtra();
console.log(`seeded devices in org_acme: ${total}`);
const devs = await t(`GET devices B (${total} rows, per-row perms)`, () => fetch(`${BASE}/v1/orgs/org_acme/devices`, { headers: H }).then(j));
console.log(`   rows returned: ${devs.devices.length}, keys per row: ${Object.keys(devs.devices[0].permissions).length}`);
await t('GET members', () => fetch(`${BASE}/v1/orgs/org_acme/members`, { headers: H }).then(j));
const dana = await fetch(`${BASE}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dana@example.test', password: 'demo1234', orgId: 'org_acme' }) }).then(j);
const DH = { Authorization: `Bearer ${dana.token}` };
await t('GET audit (owner)', () => fetch(`${BASE}/v1/orgs/org_acme/audit?limit=50`, { headers: DH }).then(j));
await t('org switch (token + me)', async () => {
  const s = await fetch(`${BASE}/v1/auth/token`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org_globex' }) }).then(j);
  await fetch(`${BASE}/v1/auth/me`, { headers: { Authorization: `Bearer ${s.token}` } }).then(j);
});

// Scaling control: same caller, small org (Globex has 2 devices; sam is auditor there).
const samGx = await fetch(`${BASE}/v1/auth/token`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ orgId: 'org_globex' }) }).then(j);
await t('GET devices (2 rows, same caller)', () => fetch(`${BASE}/v1/orgs/org_globex/devices`, { headers: { Authorization: `Bearer ${samGx.token}` } }).then(j));

server.kill();
for (const s of ['', '-wal', '-shm']) if (existsSync(DB + s)) rmSync(DB + s);
console.log('done. Verdict: first-screen path (doc+bundle+login+me) must sum <1000ms; lists must stay flat as rows grow.');
