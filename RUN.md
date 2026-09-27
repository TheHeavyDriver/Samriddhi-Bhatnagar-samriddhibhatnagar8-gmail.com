# Run — RemoteOps (`starter/`)

Requires **Node 22** (per `starter/.nvmrc`; `better-sqlite3` has no prebuilt binary for newer Node).

## Start from a clean checkout

```sh
cd starter && npm install && npm run db:reset && npm run dev
# http://localhost:8080 — demo login: sam@example.test / demo1234
```

Production mode: `npm run build && npm start`.

## Suites (last lines, verified 2026-09-27)

```sh
node scripts/check-permissions.js   # resolution engine
node scripts/check-jwt.js           # token verification
node scripts/check-api.js           # HTTP contract
npx playwright test                 # console contract (needs: npx playwright install chromium)
```

```
ALL PASS — 35 passed, 0 failed
ALL PASS — 43 passed, 0 failed
ALL PASS — 66 passed, 0 failed
25 passed (10.7s)
```

Plus `node scripts/check-personalisation.js`: `ALL PASS — 18 passed, 0 failed`.
