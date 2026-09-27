# BUILD-LOG

Append to this as you go. Commit it with the code it describes — the timestamps are part of the
evidence, and a log that arrives in one commit at the end reads as what it is.

Five lines is a real entry. Short and dated is better than long and reconstructed.

The categories we look for are listed in `DISCOVERY-BRIEF.md`. The example below shows the
*shape* of a good entry; it is a recreation of something already printed in `README.md`, so it
gives nothing away.

---

<!-- EXAMPLE — delete this block, keep the shape.

## 2026-03-04 · Phase 0 — orientation

Expected the unknown-permission test to fail on my validation code.
Observed: it passed, with foreign_keys ON, and *also* passed with the pragma removed — so the
check was never running, and the "pass" was the schema loading fine while enforcing nothing.
Changed: moved `foreign_keys = ON` to connection open and re-ran; now it raises
`FOREIGN KEY constraint failed` as the README said it would.
Note: this is the failure mode where a passing test is worse than a failing one.

-->

## Phase 0 — orientation

## 2026-09-27 · Phase 0 — orientation

Installed with system node v26: `better-sqlite3` has no prebuilt binding for it and
source build fails on v26 V8 headers (`data.lzz` fall-through/build errors in npm log).
Expected `npm rebuild` to fix it; observed `gyp ERR! build error`. Downloaded node
v22.18.0 to /tmp/opencode, reinstalled, `npm run db:reset` then worked.
Baseline against untouched skeleton: `check-jwt` 0 passed / 43 failed (every case got
`NOT_IMPLEMENTED` instead of `401 UNAUTHENTICATED` — the harness asserts the error
*shape*, so a throwing stub scores zero, as designed). `db:reset` prints the demo
logins plus the personalisation reminder: one role + one permission in the DB appear
in no document, so the engine must read tables at runtime.

## Phase 1 — token verification

## 2026-09-27 · Phase 1 — token verification

Implemented `verifyAccessToken` per AUTH-DATA-MODEL.md §10: 3-segment split, JSON parse
of header/payload, pin `alg==='HS256' && typ==='JWT'` before touching the signature,
constant-time `timingSafeEqual` compare, `exp` must be a number and `> now`
(`exp == now` is expired — half-open), exact `iss`/`aud`, non-empty `jti`.
Wrong prediction: I assumed signature should be verified before reading the header.
Reading the header first is required to pin the algorithm, but a malformed header must
still be a 401, not a crash — order is parse-header → pin-alg → verify-sig →
validate-claims. `check-jwt.js`: **43 passed, 0 failed**.

## Phase 2 — caller context and the resolution engine

## 2026-09-27 · Phase 2 — caller context and the resolution engine

First model: freshness check (`assertFresh`) applies to every request. Observation that
broke it: a suspended membership bumps `perm_version`, so asserting freshness on a
suspended caller turns the required `403 suspended` into `401 TOKEN_STALE` and loses
the reason. Moved to: skip freshness when `status === 'suspended'` (token still
verifies, resolved set is empty → every `assertCan` refuses with `suspended`).
Second surprise: `removed` must be `401` (unauthenticated), not a 403 — the membership
is gone, so there is no caller. Structural isolation: token `org` claim is the only
org addressable; `params.org !== claims.org` → `404`, identical body to missing.
Resolution core (`server/permissions.js`): deny-first regardless of scope, then
baseline + allow-grants, else implicit — one `buildPermissions` shared by `resolve`
and batched `resolveDevices` (single grant query + in-memory per-row filter, no N+1,
no cache so nothing stale). `check-permissions.js`: **35 passed, 0 failed**.

## Phase 3 — orgs, members, invites

## 2026-09-27 · Phase 3 — orgs, members, invites

Invite lifecycle: single transaction (upsert user → flip membership `invited`→`active` →
issue tokens); re-invite of a removed membership must UPDATE the existing
`UNIQUE(org_id, user_id)` row, not INSERT (else `500`/constraint). `GET /invites/{token}`
returns only `{orgName, role, email, expiresAt}`. Rank checks read `roles.rank` from
the DB (per-candidate ranks 5/15/25/35/45 exist, so no hardcoded order); `owner`
short-circuits `assertCanModify`. `DELETE /members/me` registered before
`/members/:userId` — first-match router would swallow `me` otherwise.

## Phase 4 — devices and grants

## 2026-09-27 · Phase 4 — devices and grants

Predicted an org-wide deny could be carved out per-device by a device allow; observed
`explicit_deny` — deny wins regardless of scope/specificity (D1), check the deny set
first. `device:list` gates the endpoint, `device:view` deny drops the row (never
redacted). No-laundering resolves the *caller's* set at the grant's scope and expands
each requested pattern; unknown patterns expand to nothing and fall through to the
`grant_permissions` FK → `400` (D19), never mis-reported as laundering. Relied on
`PRAGMA foreign_keys=ON` per connection (`server/db.js`) instead of code validation.
`check-api.js` devices/grants section green.

## Phase 5 — sessions

## 2026-09-27 · Phase 5 — sessions

Compound check order matters: `assertCan(session:start)` first, then the mode
permission on the same device — refusal reasons stay distinguishable
(`missing_permission` vs `missing_device_permission`). Exclusivity via the partial
unique index `one_exclusive_session_per_device` (`view` excluded), not
check-then-insert, so concurrent `control` requests yield exactly one `201` + one
`409 DEVICE_BUSY`. Grandfathering: role/grant changes bump `pv` (next session
refused) but never end in-flight sessions; suspension/removal/transfer cascade via
`endActiveSessions` with the closed `end_reason` vocabulary — there is deliberately
no `permission_revoked` reason. `check-api.js`: **66 passed, 0 failed**.

## Phase 6 — audit

## 2026-09-27 · Phase 6 — audit

Line drawn: one action → one row, written inside the same transaction as the change;
`auditDenials` wrapper records *only* denials (success rows belong to the route, else
every success logs twice). Denied attempts audited with `result:'deny'` + the refusal
reason — a success-only log can't answer "who tried to change what". Table is
append-only via `BEFORE UPDATE/DELETE` triggers; this module only INSERTs.
`GET /audit` gated by `audit:read`, paginated (`limit` 1–200, else 400).

## Phase 7 — the console

## 2026-09-27 · Phase 7 — the console (pending UI suite)

Console derives everything from the server: device rows carry the caller's per-device
resolved set (`resolveDevices`, one query + in-memory filter), so no per-row
follow-up and no role→permission table in `web/` (verified: no `role ===` in
`web/`, no `localStorage`/`sessionStorage` token usage). Presence rule implemented
as render-or-absent with `data-permission` + `data-state="unlocked"`. `login-error`
is ungated, persistent, carries `data-error-code` + live region; wrong-password and
unknown-email return identical `401` (no enumeration oracle). Sam story check is the
self-test: Acme operator (Control present, Audit absent) ↔ Globex auditor (swapped).

## 2026-09-27 · Phase 7 result — UI suite green

`npx playwright test`: **25 passed, 0 failed** (12s, clean rerun). Note: the first
full run showed 21 passed / 4 failed on the earliest shell/nav tests while a single
retry of one of them passed in isolation; the rerun from a clean state (no stray
server on :8124, fresh `dist/`) is fully green — cold-start flake, not a product
bug. Lesson logged: kill orphaned `server/index.js` processes (the `check-api`
crash-guard note in HARDENING.md warns they hold the port) before the UI suite.

## Phase 8 — hardening

## 2026-09-27 · Phase 8 — hardening

Measured: `check-jwt` 43/43, `check-permissions` 35/35, `check-api` 66/66,
`check-personalisation` 18/18 (undocumented role + permission resolve with correct
`allow`/`explicit_deny`/`implicit` — engine reads `permissions`, `permission_patterns`,
`role_permissions` at runtime, nothing hardcoded). Guarantees leaned on, not coded:
`grant_permissions` FK (unknown permission → 400), `one_exclusive_session_per_device`
(concurrent control → 201+409), `one_live_invite_per_email` (concurrent accept → one
wins), audit triggers. Deliberately not built: rate limiting, email delivery (tokens
in API response), password reset, pagination beyond audit/members — see DECISIONS.md.

## 2026-09-27 · Phase 8 — speed, formally (`node scripts/perf-check.js`)

Production server, scratch DB, medians of 5: document 2.1ms + 251KB bundle 3.2ms +
login 59.7ms + first `GET /auth/me` 1.4ms → **first-screen path ≈ 67ms, ~15x inside
the 1s budget** (loopback; excludes real-network latency, paint is trivial React).
Devices A (5 rows) 1.8ms → B (305 rows, 20-permission sets per row) 15.3ms: 61x rows
→ ~8x time, ≈0.05ms/row of JSON serialization. No N+1 by construction —
`resolveDevices` issues exactly 4 queries (catalogue, membership, baseline, one
grants query) plus an in-memory per-row filter; an N+1 would scale ~61x. Members
1.2ms, audit 1.1ms, org switch (token + me) 2.6ms. No resolution cache anywhere, so
nothing can serve stale authority — freshness is one indexed `memberships_by_user`
lookup per request.

## Open threads

## 2026-09-27 · Open threads

- UI suite still running when this was written; Phase 7 entry to be confirmed with the
  playwright count.
- `exp` uses wall-clock seconds on a single machine; no clock-skew tolerance by design.
- No cache anywhere in resolution — deliberate (freshness is free: one indexed
  `memberships_by_user` lookup + 3 small queries per request, batched per list).
